import chokidar = require( 'chokidar' );
import dotenv from 'dotenv';
import express = require( 'express' );
import helmet from 'helmet';
import mime = require( 'mime' );
import moduleAlias = require( 'module-alias' );
import path = require( 'path' );
import serveIndex = require( 'serve-index' );
import util = require( 'util' );
import winston = require( 'winston' );
import { REGISTER_INSTANCE } from 'ts-node';

moduleAlias.addAliases( {
	'@app': __dirname
} );

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
	let api: utils.SubRoute | undefined | null;
	if ( !apiName.match( /^[a-z\d-]+(\.json)?$/ ) ) {
		return utils.forbidden( req, res );
	}
	if ( apiCache.has( apiName ) ) {
		api = apiCache.get( apiName );
		if ( api ) {
			try {
				return await api.onRequest( req, res );
			} catch ( error ) {
				winston.error( error );
				return utils.internalServerError( req, res );
			}
		} else {
			return utils.notFound( req, res );
		}
	}

	let fullPath: string;
	try {
		fullPath = require.resolve( '@app/api/' + apiName );
	} catch ( error ) {
		apiCache.set( apiName, null );
		return utils.notFound( req, res );
	}

	if ( req.query.raw ) {
		return utils.sendFile( fullPath )( req, res );
	} else if ( path.extname( apiName ) === '.json' ) {
		api = {
			init: utils.voidFunction,
			onRequest: utils.sendFile( fullPath )
		};
	} else {
		try {
			api = await import( '@app/api/' + apiName ) as utils.SubRoute;
			await api.init?.();
		} catch ( error ) {
			winston.error( util.inspect( error ) );
			return utils.internalServerError( req, res );
		}
	}

	apiCache.set( apiName, api );
	try {
		await api.onRequest( req, res );
	} catch ( error ) {
		winston.error( util.inspect( error ) );
		utils.internalServerError( req, res );
	} finally {
		if ( !res.writableEnded ) {
			res.end();
		}
	}
} );

app.use( [
	'/s'
], utils.rewriteUrl( '/shortcut' ) );

app.use( [
	'/shortcut/:name'
], async function ( req, res ) {
	const shortcutName: string = req.params.name.replace( /\.n?[tj]s$/, '' ).toLowerCase();
	let shortcut: utils.SubRoute | undefined | null;
	if ( !shortcutName.match( /^[a-z\d-]+$/ ) ) {
		return utils.forbidden( req, res );
	}
	if ( shortcutCache.has( shortcutName ) ) {
		shortcut = shortcutCache.get( shortcutName );
		if ( shortcut ) {
			try {
				return await shortcut.onRequest( req, res );
			} catch ( error ) {
				winston.error( error );
				return utils.internalServerError( req, res );
			}
		} else {
			return utils.notFound( req, res );
		}
	}

	try {
		require.resolve( '@app/shortcut/' + shortcutName );
	} catch ( error ) {
		shortcutCache.set( shortcutName, null );
		return utils.notFound( req, res );
	}

	try {
		shortcut = await import( '@app/shortcut/' + shortcutName ) as utils.SubRoute;
		await shortcut.init?.();
	} catch ( error ) {
		winston.error( util.inspect( error ) );
		return utils.internalServerError( req, res );
	}

	shortcutCache.set( shortcutName, shortcut );
	try {
		await shortcut.onRequest( req, res );
	} catch ( error ) {
		winston.error( util.inspect( error ) );
		utils.internalServerError( req, res );
	} finally {
		if ( !res.writableEnded ) {
			res.end();
		}
	}
} );

app.use( [
	'/r'
], utils.rewriteUrl( '/reviewer' ) );

app.use( [
	'/reviewer'
], serveIndex( path.join( __dirname, 'reviewer' ) ), express.static( path.join( __dirname, 'reviewer' ) ) );

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
	.on( 'all', function ( event, pathName ) {
		if ( pathName.match( /\.d\.ts$/ ) ) {
			return;
		}

		winston.info( util.format( 'file %s: %s', event, pathName ) );
		const relative = path.relative( __dirname, path.resolve( __dirname, pathName ) ).split( /[/\\]/ );
		if ( relative.length !== 2 ) {
			return;
		}
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete require.cache[ require.resolve( pathName ) ];
		const cacheName = relative[ 1 ].replace( /\.[jt]s$/, '' );
		switch ( relative[ 0 ] ) {
			case 'api':
				winston.info( util.format( 'reload api %s', cacheName ) );
				apiCache.delete( cacheName );
				break;

			case 'shortcut':
				winston.info( util.format( 'reload shortcut %s', cacheName ) );
				shortcutCache.delete( cacheName );
				break;
		}
	} );

const server = app.listen( defaultPort, function () {
	let address = server.address();
	if ( address === null ) {
		address = '';
	} else if ( typeof address === 'object' ) {
		address = util.format( 'IP: %s, PORT: %s', address.address, address.port );
	}
	winston.info( 'Server Start At ' + address );
} );
