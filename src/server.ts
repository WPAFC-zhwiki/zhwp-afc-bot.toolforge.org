import fs = require( 'node:fs' );
import path = require( 'node:path' );
import util = require( 'node:util' );

import chokidar = require( 'chokidar' );
import dotenv from 'dotenv';
import express = require( 'express' );
import helmet from 'helmet';
import mime = require( 'mime' );
import moduleAlias = require( 'module-alias' );
import serveIndex = require( 'serve-index' );
import winston = require( 'winston' );
import { REGISTER_INSTANCE } from 'ts-node';

import * as cache from '@app/cache';

moduleAlias.addAliases( {
	'@app': __dirname
} );

// eslint-disable-next-line import/no-named-as-default-member
dotenv.config( {
	path: path.join( __dirname, '..', '.env' )
} );

mime.define( {
	'text/plain': [ 'ts', 'cts', 'mts' ]
} );

import * as utils from '@app/utils';
import timeout from '@app/timeout';
import cors from '@app/cors';
import hsts from '@app/hsts';
import icgRunIog from '@app/ICG-BOT/run.log';
import icgRestart from '@app/ICG-BOT/restart';

const logFormat: winston.Logform.FormatWrap = winston.format( function ( info: winston.Logform.TransformableInfo ) {
	info.level = info.level.toUpperCase();
	if ( info.stack ) {
		info.message = `${ String( info.message ) }\n${ String( info.stack ) }`;
	}
	return info;
} );

winston.add( new winston.transports.Console( {
	format: winston.format.combine(
		logFormat(),
		winston.format.colorize(),
		winston.format.timestamp( {
			format: 'YYYY-MM-DD HH:mm:ss'
		} ),
		winston.format.printf( function ( info ) {
			return `${ String( info.timestamp ) } [${ info.level }] ${ String( info.message ) }`;
		} )
	)
} ) );

winston.level = 'debug';

const apiCache = new Map<string, utils.SubRoute | null>();
const reviewerProgramCache = new Map<string, utils.SubRoute | null>();
const shortcutCache = new Map<string, utils.SubRoute | null>();

const defaultPort = process.env.PORT ? +process.env.PORT : null;

// fix function declare override error
express.response.status = function ( this: express.Response, code ) {
	this.statusCode = code;
	return this;
};
const oldSend = express.response.send;
express.response.send = function ( this: express.Response, body?: unknown ) {
	if ( this.writableEnded ) {
		const error = new Error( 'Try to call express.response.send after writableEnded=true' );
		Error.captureStackTrace( error );
		winston.warn( util.inspect( error ) );
		return this;
	}
	return oldSend.call( this, body );
};

const app = express();

app.set( 'view engine', 'ejs' );

app.use(
	timeout,
	helmet( {
		contentSecurityPolicy: false, // Toolforge wll add Content-Security-Policy-Report-Only automatically
		hsts: false // define in hsts.ts
	} ),
	hsts,
	function ( req, res, next ) {
		res.on( 'finish', function () {
			winston.debug(
				util.format(
					'%s - %s %s HTTP/%s %d',
					req.headers.host,
					req.method,
					req.originalUrl,
					req.httpVersion,
					res.statusCode
				)
			);
		} );
		return next();
	}
);

if ( process.env.FILES_PATH ) {
	app.use( '/files', express.static( process.env.FILES_PATH ) );
}

if ( process.env.ICG_BOT_ROOT ) {
	app.get( '/ICG-BOT', function ( req, res ) {
		utils.movedPermanently( 'https://github.com/WPAFC-zhwiki/ICG-BOT', req, res );
	} );

	app.get( [
		'/ICG-BOT/run.log',
		'/ICG-BOT/out.njs'
	], function ( req, res ) {
		icgRunIog( req, res );
	} );

	if ( process.env.ICG_BOT_ERR_LOG ) {
		app.get( '/ICG-BOT/err.log', utils.sendFile( process.env.ICG_BOT_ERR_LOG, {
			headers: {
				'Content-Type': 'text/plain;charset=UTF-8',
				'Content-Disposition': 'inline'
			}
		} ) );
	}

	app.get( '/ICG-BOT/restart', function ( req, res ) {
		icgRestart( req, res );
	} );
}

app.use( [
	'/a'
], cors, utils.rewriteUrl( '/api' ) );

app.use( [
	'/api/:name'
], cors, async function ( req, res ) {
	const apiName: string = req.params.name.replace( /\.n?[tj]s$/, '' ).toLowerCase();
	if ( !apiName.match( /^[a-z\d-]+(\.json)?$/ ) ) {
		return utils.forbidden( req, res );
	}

	return utils.subRouteHandler( req, res, apiCache, apiName, 'api' );
} );

app.use( [
	'/s'
], utils.rewriteUrl( '/shortcut' ) );

app.use( [
	'/shortcut/:name'
], async function ( req, res ) {
	const shortcutName: string = req.params.name.replace( /\.n?[tj]s$/, '' ).toLowerCase();
	if ( !shortcutName.match( /^[a-z\d-]+$/ ) ) {
		return utils.forbidden( req, res );
	}

	return utils.subRouteHandler( req, res, shortcutCache, shortcutName, 'shortcut' );
} );

app.use( [
	'/r'
], utils.rewriteUrl( '/reviewer' ) );

app.use( [
	'/reviewer'
], serveIndex( path.join( __dirname, 'reviewer' ) ), async function ( req, res, next ) {
	const subPath: string = req.path.slice( 1 );
	if ( path.basename( subPath ).startsWith( '.' ) ) {
		return utils.notFound( req, res );
	}
	if (
		!subPath.match( /^[a-z\d-]+\.js$/ ) ||
		!fs.existsSync( path.join( __dirname, 'reviewer', `.${ subPath }.nodejs-program` ) ) ||
		new URL( req.url, utils.origin ).searchParams.has( 'raw' )
	) {
		return next();
	}

	const programName = subPath.slice( 0, -( '.js'.length ) );
	return utils.subRouteHandler( req, res, reviewerProgramCache, programName, 'reviewer' );
}, express.static( path.join( __dirname, 'reviewer' ) ) );

// for test
app.get( '/generate_204', function ( _req, res ) {
	res.status( 204 );
	res.end();
} );

app.use( utils.notFound );

chokidar
	.watch(
		[
			__dirname
		], {
			ignored: REGISTER_INSTANCE in process ? '*.js' : '*.ts',
			ignoreInitial: true,
			ignorePermissionErrors: true,
			usePolling: true
		}
	)
	.on( 'all', async function ( event, pathName ) {
		if ( pathName.match( /\.d\.ts$/ ) ) {
			return;
		}

		winston.info( util.format( 'file %s: %s', event, pathName ) );
		const relative = path.relative( __dirname, path.resolve( __dirname, pathName ) ).split( /[/\\]/ );
		if ( relative.length !== 2 ) {
			return;
		}
		if ( event === 'unlink' ) {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete require.cache[ path.resolve( __dirname, pathName ) ];
		} else {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete require.cache[ require.resolve( pathName ) ];
		}
		const cacheName = relative[ 1 ].replace( /\.[jt]s$/, '' );
		switch ( relative[ 0 ] ) {
			case 'api':
				winston.info( util.format( 'reload api %s', cacheName ) );
				await apiCache.get( cacheName )?.deinit?.();
				apiCache.delete( cacheName );
				break;

			case 'shortcut':
				winston.info( util.format( 'reload shortcut %s', cacheName ) );
				await shortcutCache.get( cacheName )?.deinit?.();
				shortcutCache.delete( cacheName );
				break;

			case 'reviewer':
				winston.info( util.format( 'reload reviewer program %s', cacheName ) );
				await reviewerProgramCache.get( cacheName )?.deinit?.();
				reviewerProgramCache.delete( cacheName );
				break;
		}
	} );

Promise.all( [
	cache.init()
] ).then( () => {
	const server = app.listen( defaultPort, function () {
		let address = server.address();
		if ( address === null ) {
			address = '';
		} else if ( typeof address === 'object' ) {
			address = util.format( 'IP: %s, PORT: %s', address.address, address.port );
		}
		winston.info( 'Server Start At ' + address );
	} );
} );
