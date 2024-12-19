import fs from 'node:fs';
import path from 'node:path';
import { format, inspect } from 'node:util';

import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import mime from 'mime';
import serveIndex from 'serve-index';
import winston from 'winston';

import * as cache from '@app/cache/index.mjs';
import cors from '@app/cors.mjs';
import hsts from '@app/hsts.mjs';
import icgRestart from '@app/ICG-BOT/restart.mjs';
import icgRunIog from '@app/ICG-BOT/run.log.mjs';
import timeout from '@app/timeout.mjs';
import * as utils from '@app/utils.mjs';

const __dirname = import.meta.dirname;

dotenv.config( {
	path: path.join( __dirname, '..', '.env' ),
} );

mime.define( {
	'text/plain': [ 'ts', 'cts', 'mts' ],
} );

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
			format: 'YYYY-MM-DD HH:mm:ss',
		} ),
		winston.format.printf( function ( info ) {
			return `${ String( info.timestamp ) } [${ info.level }] ${ String( info.message ) }`;
		} )
	),
} ) );

winston.level = 'debug';

const apiCache = new Map<string, utils.SubRoute | undefined>();
const reviewerProgramCache = new Map<string, utils.SubRoute | undefined>();
const shortcutCache = new Map<string, utils.SubRoute | undefined>();

const defaultPort = process.env.PORT ? +process.env.PORT : undefined;

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
		winston.warn( inspect( error ) );
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
		hsts: false, // define in hsts.ts
	} ),
	hsts,
	function ( request, response, next ) {
		response.on( 'finish', function () {
			winston.debug(
				format(
					'%s - %s %s HTTP/%s %d',
					request.headers.host,
					request.method,
					request.originalUrl,
					request.httpVersion,
					response.statusCode
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
	app.get( '/ICG-BOT', function ( request, response ) {
		utils.movedPermanently( 'https://github.com/WPAFC-zhwiki/ICG-BOT', request, response );
	} );

	app.get( [
		'/ICG-BOT/run.log',
		'/ICG-BOT/out.njs',
	], function ( request, response ) {
		icgRunIog( request, response );
	} );

	if ( process.env.ICG_BOT_ERR_LOG ) {
		app.get( '/ICG-BOT/err.log', utils.sendFile( process.env.ICG_BOT_ERR_LOG, {
			headers: {
				'Content-Type': 'text/plain;charset=UTF-8',
				'Content-Disposition': 'inline',
			},
		} ) );
	}

	if ( process.env.ICG_BOT_HEARTBEAT ) {
		app.get( '/ICG-BOT/heartbeat.txt', utils.sendFile( process.env.ICG_BOT_HEARTBEAT, {
			headers: {
				'Content-Type': 'text/plain;charset=UTF-8',
				'Content-Disposition': 'inline',
			},
		} ) );
	}

	app.get( '/ICG-BOT/restart', function ( request, response ) {
		icgRestart( request, response );
	} );
}

app.use( [
	'/a',
], cors, utils.rewriteUrl( '/api' ) );

app.use( [
	'/api/:name',
], cors, async function ( request, response ) {
	const apiName: string = request.params.name.replace( /\.n?[tj]s$/, '' ).toLowerCase();
	if ( !/^[a-z\d-]+(\.json)?$/.test( apiName ) ) {
		return utils.forbidden( request, response );
	}

	return utils.subRouteHandler( request, response, apiCache, apiName, 'api' );
} );

app.use( [
	'/s',
], utils.rewriteUrl( '/shortcut' ) );

app.use( [
	'/shortcut/:name',
], async function ( request, response ) {
	const shortcutName: string = request.params.name.replace( /\.n?[tj]s$/, '' ).toLowerCase();
	if ( !/^[a-z\d-]+$/.test( shortcutName ) ) {
		return utils.forbidden( request, response );
	}

	return utils.subRouteHandler( request, response, shortcutCache, shortcutName, 'shortcut' );
} );

app.use( [
	'/r',
], utils.rewriteUrl( '/reviewer' ) );

app.use( [
	'/reviewer',
], serveIndex( path.join( __dirname, 'reviewer' ) ), async function ( request, response, next ) {
	const subPath: string = request.path.slice( 1 );
	if ( path.basename( subPath ).startsWith( '.' ) ) {
		return utils.notFound( request, response );
	}
	if (
		!/^[a-z\d-]+\.js$/.test( subPath ) ||
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		!fs.existsSync( path.join( __dirname, 'reviewer', `.${ subPath }.nodejs-program` ) ) ||
		new URL( request.url, utils.origin ).searchParams.has( 'raw' )
	) {
		return next();
	}

	const programName = subPath.slice( 0, -( '.js'.length ) );
	return utils.subRouteHandler( request, response, reviewerProgramCache, programName, 'reviewer' );
}, express.static( path.join( __dirname, 'reviewer' ) ) );

// for test
app.get( '/generate_204', function ( _request, response ) {
	response.status( 204 );
	response.end();
} );

app.use( ( request, response ) => utils.notFound( request, response ) );

cache.init().then( () => {
	const server = app.listen( defaultPort, function () {
		let address = server.address();
		if ( address === null ) {
			address = '';
		} else if ( typeof address === 'object' ) {
			address = format( 'IP: %s, PORT: %s', address.address, address.port );
		}
		winston.info( 'Server Start At ' + address );
	} );
} );
