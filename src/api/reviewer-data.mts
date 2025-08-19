import { inspect } from 'node:util';

import express from 'express';
import winston from 'winston';

import { getWithCacheAsync, removeCachedItem } from '@app/cache/index.mjs';
import { doReplicaQuery, isReplicaQueryEnable } from '@app/replica.mjs';
import * as utils from '@app/utils.mjs';

function withBufferToStringJSONStringify( json: unknown ) {
	const oldBufferToJSON = Buffer.prototype.toJSON;

	Buffer.prototype.toJSON = function ( this: Buffer ) {
		return this.toString( 'utf8' );
	};
	try {
		return JSON.stringify( json );
	} finally {
		Buffer.prototype.toJSON = oldBufferToJSON;
	}
}

export async function onRequest( request: express.Request, response: express.Response ) {
	const apiVersion = 1;

	if ( request.method.toUpperCase() !== 'GET' && request.method.toUpperCase() !== 'POST' ) {
		return utils.methodNoAllow( request, response, apiVersion );
	}
	if ( !isReplicaQueryEnable ) {
		return utils.replicaAccessDisabled( request, response, apiVersion );
	}
	const referrer = request.get( 'referrer' );
	if ( !referrer || !referrer.startsWith( utils.origin ) ) {
		return utils.forbidden( request, response, apiVersion );
	}

	function sendBroken() {
		utils.internalServerError( request, response, apiVersion );
	}

	const cacheName = 'api/reviewer-data/data';
	if ( new URL( request.url, utils.origin ).searchParams.has( 'purge' ) ) {
		await removeCachedItem( cacheName );
		return utils.movedPermanently( new URL( request.originalUrl, utils.origin ).pathname, request, response );
	}
	const requestSplit = new URL( request.originalUrl, utils.origin ).pathname.split( '/' ).filter( Boolean ); // [ 'api', 'reviewer-data', ... ]
	if ( requestSplit.length === 3 ) {
		if ( requestSplit.length > 3 || requestSplit[ 2 ] !== 'purge' ) {
			return utils.badRequest( request, response, apiVersion );
		} else if ( request.method.toUpperCase() !== 'POST' ) {
			return utils.methodNoAllow( request, response, apiVersion );
		}
		await removeCachedItem( cacheName );
		response.status( 204 );
		response.setHeader( 'Cache-Control', 'no-store' );
		response.end();
		return;
	}

	const returnValue = await getWithCacheAsync<[string, unknown]>(
		cacheName,
		60 * 60 * 1000,
		async () => {
			try {
				const queryResults = (
					await doReplicaQuery( '\
SELECT \
	COUNT(`rc_id`) AS `reviews`, \
	`actor_name` as `user`, \
	SUM(`comment_text` LIKE "%发布已接受的[[PJ:AFC|条目建立]]草稿%" OR `comment_text` LIKE "%發布已接受的[[PJ:AFC|條目建立]]草稿%") AS `acceptCount`, \
	SUM(`comment_text` LIKE "%仍需改善的草稿%") AS `declineCount`, \
	SUM(`comment_text` LIKE "%拒绝再次提交的草稿%" OR `comment_text` LIKE "%拒絕再次提交的草稿%") AS `rejectCount`, \
	CONCAT(ROUND(SUM(`comment_text` LIKE "%发布已接受的[[PJ:AFC|条目建立]]草稿%" OR `comment_text` LIKE "%發布已接受的[[PJ:AFC|條目建立]]草稿%") * 100 / COUNT(`rc_id`), 1), "%") AS `acceptPercentage`, \
	CONCAT(ROUND(SUM(`comment_text` LIKE "%仍需改善的草稿%") * 100 / COUNT(`rc_id`), 1), "%") AS `declinePercentage`, \
	CONCAT(ROUND(SUM(`comment_text` LIKE "%拒绝再次提交的草稿%" OR `comment_text` LIKE "%拒絕再次提交的草稿%") * 100 / COUNT(`rc_id`), 1), "%") AS `rejectPercentage` \
FROM `recentchanges_userindex` \
LEFT JOIN `actor` ON `rc_actor` = `actor_id` \
LEFT JOIN `comment` ON `rc_comment_id` = `comment_id` \
WHERE \
	(`rc_namespace` = 118 OR `rc_namespace` = 2 OR `rc_namespace` = 0) AND (`rc_type` < 5) \
	AND (`comment_text` LIKE "%发布已接受的[[PJ:AFC|条目建立]]草稿%" OR `comment_text` LIKE "%發布已接受的[[PJ:AFC|條目建立]]草稿%" OR `comment_text` LIKE "%仍需改善的草稿%" OR `comment_text` LIKE "%拒绝再次提交的草稿%" OR `comment_text` LIKE "%拒絕再次提交的草稿%") \
	AND (`rc_timestamp` >= DATE_ADD(NOW(), INTERVAL -28 DAY) ) \
GROUP BY `rc_actor` ORDER BY `reviews` DESC; \
				' )
				// eslint-disable-next-line unicorn/no-await-expression-member
				).result;
				if ( request.isTimeOut ) {
					return;
				}
				if ( !Array.isArray( queryResults ) ) {
					winston.error( `[reviewer/reviewer-data] Unknown response: ${ inspect( queryResults ) }.` );
					sendBroken();
					return;
				}
				try {
					return [
						new Date().toISOString(),
						JSON.parse( withBufferToStringJSONStringify( queryResults ) ) as unknown,
					];
				} catch ( parseDataError ) {
					winston.error( `[api/reviewer-data] Unknown error when parse data: ${ inspect( parseDataError ) }.` );
					sendBroken();
					return;
				}
			} catch ( queryError ) {
				winston.error( `[api/reviewer-data] Unknown error when query data: ${ inspect( queryError ) }.` );
				sendBroken();
				return;
			}
		}
	);

	if ( !request.isTimeOut ) {
		if ( returnValue ) {
			response.status( 200 );
			response.setHeader( 'Cache-Control', 'max-age=0, must-revalidate' );
			response.json( {
				apiVersion,
				dataTimestamp: returnValue[ 0 ],
				reviewerData: returnValue[ 1 ],
			} );
			response.end();
		}

		if ( !response.writableEnded ) {
			return utils.badGateway( request, response, apiVersion );
		}
	}
}
