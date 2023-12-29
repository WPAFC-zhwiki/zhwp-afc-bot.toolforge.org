import fs = require( 'node:fs' );
import os = require( 'node:os' );
import path = require( 'node:path' );
import util = require( 'node:util' );

import express = require( 'express' );
import iniparser = require( 'iniparser' );
import winston = require( 'winston' );
import mysql = require( 'mysql' );

import { methodNoAllow } from '@app/utils';

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
		pool.on( 'error', ( error ) => winston.error( util.format( '[listSysopPatroller] Pool error: %s', util.inspect( error ) ) ) );
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

	function checkTimeout( resolve: () => void ) {
		if ( req.isTimeOut ) {
			resolve();
			return true;
		}
	}

	await new Promise<void>( ( resolve ) => {
		pool.getConnection( ( error, conn ) => {
			if ( error ) {
				winston.error( util.format( '[listSysopPatroller] Fail to getConnection: %s', util.inspect( error ) ) );
				res.status( 500 );
				res.json( {
					status: 500
				} );
				res.end();
				resolve();
				return;
			}
			if ( checkTimeout( resolve ) ) {
				return;
			}
			conn.query( '\
				SELECT user_name, ug_group\
				FROM user\
				LEFT JOIN user_groups on user_id = ug_user\
				WHERE ug_group = "sysop" OR ug_group = "patroller"\
				ORDER BY user_name ASC;\
			', function ( qError, results ) {
				conn.release();
				if ( qError ) {
					winston.error( util.format( '[listSysopPatroller] Fail to query: %s', util.inspect( qError ) ) );
					res.status( 500 );
					res.json( {
						status: 500
					} );
					res.end();
					resolve();
					return;
				}
				if ( checkTimeout( resolve ) ) {
					return;
				}
				if ( !Array.isArray( results ) ) {
					winston.error( util.format( '[listSysopPatroller] Unknown response: %s', util.inspect( results ) ) );
					res.status( 500 );
					res.json( {
						status: 500
					} );
					res.end();
					resolve();
					return;
				}
				try {
					const resultData = [];
					for ( const line of results ) {
						resultData.push( ( line as { user_name: Buffer; } ).user_name.toString( 'utf-8' ) );
					}
					res.status( 200 );
					res.json( {
						status: 200,
						data: resultData
					} );
					res.end();
				} catch ( xError ) {
					winston.error( util.format( '[listSysopPatroller] Unknown error: %s', util.inspect( xError ) ) );
					res.status( 500 );
					res.json( {
						status: 500
					} );
					res.end();
					resolve();
				}
			} );
		} );
	} );
}

export async function deinit() {
	return new Promise<void>( ( resolve ) => {
		pool.end( ( error ) => {
			resolve();
			if ( error ) {
				winston.error( util.format( '[listSysopPatroller] Fail to close pool: %s', util.inspect( error ) ) );
			}
		} );
	} );
}
