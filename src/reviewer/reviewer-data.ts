import util = require( 'node:util' );

import express = require( 'express' );
import winston = require( 'winston' );

import { methodNoAllow, getWithCacheAsync, internalServerError, badGateway } from '@app/utils';
import { doReplicaQuery, isReplicaQueryEnable } from '@app/database';

function withBufferToStringJSONStringify( json: unknown ) {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
	const oldBufferToJSON = Buffer.prototype.toJSON;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
	Buffer.prototype.toJSON = function ( this: Buffer ) {
		return this.toString( 'utf-8' );
	};
	try {
		return JSON.stringify( json );
	} finally {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		Buffer.prototype.toJSON = oldBufferToJSON;
	}
}

export async function onRequest( req: express.Request, res: express.Response ) {
	if ( req.method.toUpperCase() !== 'GET' ) {
		return methodNoAllow( req, res );
	}
	if ( !isReplicaQueryEnable ) {
		res.status( 422 );
		res.json( {
			status: 422
		} );
		res.end();
		return;
	}

	function sendBroken() {
		internalServerError( req, res );
	}

	const data = await getWithCacheAsync<unknown>(
		'api/list-sysop-patroller/data',
		5 * 60 * 1000,
		async () => {
			try {
				const queryResults = await doReplicaQuery( '\
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
				' );
				if ( req.isTimeOut ) {
					return null;
				}
				if ( !Array.isArray( queryResults ) ) {
					winston.error( `[reviewer/reviewer-data] Unknown response: ${ util.inspect( queryResults ) }.` );
					sendBroken();
					return null;
				}
				try {
					return JSON.parse( withBufferToStringJSONStringify( queryResults ) ) as unknown;
				} catch ( parseDataError ) {
					winston.error( `[reviewer/reviewer-data] Unknown error when parse data: ${ util.inspect( parseDataError ) }.` );
					sendBroken();
					return null;
				}
			} catch ( queryError ) {
				winston.error( `[reviewer/reviewer-data] Unknown error when query data: ${ util.inspect( queryError ) }.` );
				sendBroken();
				return null;
			}
		}
	);

	if ( !req.isTimeOut ) {
		if ( data ) {
			res.status( 200 );
			res.render( 'reviewer-data', {
				reviewData: data
			} );

			res.setHeader( 'Cache-Control', 'max-age=86400, must-revalidate' );
			res.end();
		}

		if ( !res.writableEnded ) {
			return badGateway( req, res );
		}
	}
}
