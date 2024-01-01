import fs = require( 'node:fs' );
import os = require( 'node:os' );
import path = require( 'node:path' );
import util = require( 'node:util' );

import iniparser = require( 'iniparser' );
import winston = require( 'winston' );
import mysql = require( 'mysql' );

export const isReplicaQueryEnable = !!process.env.ENABLE_REPLICA_QUERY && process.env.ENABLE_REPLICA_QUERY !== '0';

let pool: mysql.Pool;

async function init() {
	if ( isReplicaQueryEnable && !pool ) {
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
			connectionLimit: 5,
			queueLimit: 5
		} );
		const pendingThreadIds = new Map<number, NodeJS.Timeout>();
		pool.on( 'error', ( error ) => winston.error( `[replica] Pool error: ${ util.inspect( error ) }.` ) );
		pool.on( 'connection', ( connection: mysql.PoolConnection ) => {
			const threadId = connection.threadId;
			winston.debug( `[replica] mysql event connection: ${ threadId }` );
		} );
		pool.on( 'acquire', ( connection: mysql.PoolConnection ) => {
			const threadId = connection.threadId;
			winston.debug( `[replica] mysql event acquire: ${ threadId }` );
			if ( threadId && pendingThreadIds.has( threadId ) ) {
				clearTimeout( pendingThreadIds.get( threadId ) );
				pendingThreadIds.delete( threadId );
			}
		} );
		pool.on( 'release', ( connection: mysql.PoolConnection ) => {
			const threadId = connection.threadId;
			winston.debug( `[replica] mysql event release: ${ threadId }` );
			if ( threadId ) {
				pendingThreadIds.set( threadId, setTimeout( () => {
					winston.debug( `[replica] mysql connection destroy: ${ threadId }` );
					connection.destroy();
					pendingThreadIds.delete( threadId );
				}, 2 * 60 * 1000 /* 2 min */ ) );
			}
		} );
		pool.on( 'connection', ( connection: mysql.PoolConnection ) => {
			const threadId = connection.threadId;
			winston.debug( `[replica] mysql event enqueue: ${ threadId }` );
		} );
	}
}

export async function getDatabase(): Promise<mysql.PoolConnection|null> {
	if ( !isReplicaQueryEnable ) {
		return Promise.reject( new Error( 'Replica query is disabled.' ) );
	}

	await init();
	return new Promise<mysql.PoolConnection>( ( resolve, reject ) => {
		pool.getConnection( ( error, conn ) => {
			if ( error ) {
				reject( error );
				return;
			}
			resolve( conn );
		} );
	} );
}

export interface QueryResult<R> {
	result: R;
	fields: mysql.FieldInfo[] | undefined;
}

export async function doReplicaQuery<R>( sql: string, values?: string[] ): Promise<QueryResult<R>> {
	const conn = await getDatabase();

	if ( conn ) {
		return new Promise<QueryResult<R>>( ( resolve, reject ) => {
			conn.query(
				{
					sql,
					values
				},
				( error, result, fields ) => {
					conn.release();
					if ( error ) {
						reject( error );
					} else {
						resolve( { result: result as R, fields } );
					}
				}
			);
		} );
	}

	return Promise.reject( new Error( 'Replica query is disabled.' ) );
}
