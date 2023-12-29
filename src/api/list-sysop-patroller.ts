import fs = require( 'node:fs' );
import os = require( 'node:os' );
import path = require( 'node:path' );
import util = require( 'node:util' );

import express = require( 'express' );
import iniparser = require( 'iniparser' );
import winston = require( 'winston' );
import mysql = require( 'mysql' );

import { methodNoAllow, getWithCacheAsync } from '@app/utils';

const enableQuery = !!process.env.ENABLE_REPLICA_QUERY && process.env.ENABLE_REPLICA_QUERY !== '0';

let pool: mysql.Pool;

export async function init() {
	if ( enableQuery ) {
		const configFile = path.join( os.homedir(), 'replica.my.cnf' );
		if ( !fs.existsSync( configFile ) ) {
			throw new Error( '~/replica.my.cnf no found.' );
		}
		const dbCfg: {
			client: {
				user: string;
				password: string;
			};
		} = iniparser.parseString( await fs.promises.readFile( configFile, { encoding: 'utf-8' } ) );
		pool = mysql.createPool( {
			host: 'zhwiki.web.db.svc.eqiad.wmflabs',
			user: dbCfg.client.user,
			password: dbCfg.client.password,
			database: 'zhwiki_p',
			charset: 'utf8mb4_unicode_ci',
			timezone: 'Z',
			connectTimeout: 10000,
			connectionLimit: 1,
			queueLimit: 2
		} );
		pool.on( 'error', ( error ) => winston.error( `[api/listSysopPatroller] Pool error: ${ util.inspect( error ) }.` ) );
	}
}

export async function onRequest( req: express.Request, res: express.Response ) {
	if ( req.method.toUpperCase() !== 'GET' ) {
		return methodNoAllow( req, res );
	}
	if ( !enableQuery ) {
		res.status( 422 );
		res.json( {
			status: 422
		} );
		res.end();
		return;
	}

	function sendBroken() {
		res.status( 500 );
		res.json( {
			status: 500
		} );
		res.end();
	}

	function checkTimeout( resolve: ( value: null ) => void ) {
		if ( req.isTimeOut ) {
			resolve( null );
			return true;
		}
	}

	const data = await getWithCacheAsync<string[]>(
		'api/listSysopPatroller/data',
		5 * 60 * 1000,
		() => new Promise<string[]|null>( ( resolve ) => {
			pool.getConnection( ( error, conn ) => {
				if ( error ) {
					winston.error( `[api/listSysopPatroller] Fail to getConnection: ${ util.inspect( error ) }.` );
					sendBroken();
					resolve( null );
					return;
				}
				if ( checkTimeout( resolve ) ) {
					return;
				}
				conn.query( '\
					SELECT user_name\
					FROM user\
					LEFT JOIN user_groups on user_id = ug_user\
					WHERE ug_group = "sysop" OR ug_group = "patroller"\
					ORDER BY user_name ASC;\
				', function ( qError, results ) {
					conn.release();
					if ( qError ) {
						winston.error( `[api/listSysopPatroller] Fail to query: ${ util.inspect( qError ) }.` );
						sendBroken();
						resolve( null );
						return;
					}
					if ( checkTimeout( resolve ) ) {
						return;
					}
					if ( !Array.isArray( results ) ) {
						winston.error( `[api/listSysopPatroller] Unknown response: ${ util.inspect( results ) }.` );
						sendBroken();
						resolve( null );
						return;
					}
					try {
						const resultData = [];
						for ( const line of results ) {
							resultData.push( ( line as { user_name: Buffer; } ).user_name.toString( 'utf-8' ) );
						}
						resolve( resultData );
					} catch ( xError ) {
						winston.error( `[api/listSysopPatroller] Unknown error: ${ util.inspect( xError ) }.` );
						sendBroken();
						resolve( null );
					}
				} );
			} );
		} )
	);

	if ( !req.isTimeOut ) {
		if ( data ) {
			res.status( 200 );
			res.json( {
				status: 200,
				data: data
			} );

			res.setHeader( 'Cache-Control', 'max-age=86400, must-revalidate' );
			res.end();
		}

		if ( !res.writableEnded ) {
			res.status( 502 );
			res.json( {
				status: 502
			} );

			res.end();
		}
	}
}

export async function deinit() {
	return new Promise<void>( ( resolve ) => {
		pool.end( ( error ) => {
			resolve();
			if ( error ) {
				winston.error( `[api/listSysopPatroller] Fail to close pool: ${ util.inspect( error ) }.` );
			}
		} );
	} );
}
