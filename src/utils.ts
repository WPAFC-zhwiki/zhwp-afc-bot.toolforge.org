import util = require( 'node:util' );

import express = require( 'express' );
import expressPackageJson = require( 'express/package.json' );
import winston = require( 'winston' );

import type { SendFileOptions } from 'express-serve-static-core';

export const origin = 'https://zhwp-afc-bot.toolforge.org';

export function voidFunction() {
	// noop
}

export function mayEncodeAbsoluteURI( uri: string ) {
	const url = new URL( uri, origin );
	if ( url.origin === origin ) {
		return url.href.slice( origin.length );
	}
	return url.href;
}

// eslint-disable-next-line max-len
function renderDefaultPage( code: unknown, req: express.Request, res: express.Response, args: Record<string, string> = {} ) {
	const pathname = new URL( req.originalUrl, origin ).pathname;
	res.render( 'status/' + String( code ), {
		expressVersion: expressPackageJson.version,
		method: req.method.toUpperCase(),
		pathname,
		...args
	} );
}

export function rewriteUrl( newPrefix: string ) {
	return function ( req: express.Request, res: express.Response ) {
		movedPermanently( newPrefix + req.url, req, res );
	};
}

export function movedPermanently( location: string, req: express.Request, res: express.Response ) {
	res.status( 301 );
	res.set( 'Location', mayEncodeAbsoluteURI( location ) );
	renderDefaultPage( 301, req, res, {
		location
	} );
	res.end();
}

export function badRequest( req: express.Request, res: express.Response ) {
	res.status( 400 );
	renderDefaultPage( 400, req, res );
	res.end();
}

export function forbidden( req: express.Request, res: express.Response ) {
	res.status( 403 );
	renderDefaultPage( 403, req, res );
	res.end();
}

export function notFound( req: express.Request, res: express.Response ) {
	res.status( 404 );
	renderDefaultPage( 404, req, res );
	res.end();
}

export function methodNoAllow( req: express.Request, res: express.Response ) {
	res.status( 405 );
	renderDefaultPage( 405, req, res );
	res.end();
}

export function replicaAccessDisabled( req: express.Request, res: express.Response ) {
	res.status( 422 );
	renderDefaultPage( '422-replica-access-disabled', req, res );
	res.end();
}

export function internalServerError( req: express.Request, res: express.Response ) {
	res.status( 500 );
	renderDefaultPage( 500, req, res );
	res.end();
}

export function badGateway( req: express.Request, res: express.Response ) {
	res.status( 502 );
	renderDefaultPage( 502, req, res );
	res.end();
}

export function unavailable( req: express.Request, res: express.Response ) {
	res.status( 503 );
	renderDefaultPage( 503, req, res );
	res.setHeader( 'Retry-After', 120 );
	res.end();
}

export function timeOut( req: express.Request, res: express.Response ) {
	res.writeHead( 503, 'Request Timeout' );
	renderDefaultPage( 'timeout', req, res );
	res.setHeader( 'Retry-After', 600 );
	res.end();
}

export type {
	SendFileOptions
};

export function sendFile( fileName: string, options: SendFileOptions = {} ) {
	options.maxAge = options.maxAge ?? 86400;
	return async function ( _req: express.Request, res: express.Response ) {
		winston.debug( util.format( 'Send file %s (options: %o)......', fileName, options ) );
		res.status( 200 );
		await new Promise<void>( function ( resolve, reject ) {
			res.sendFile( fileName, options, function ( error ) {

				if ( error ) {
					reject( error );
				}
				resolve();
			} );
		} );
		res.end();
	};
}

export interface SubRoute {
	init?(): Promise<void> | void;
	deinit?(): Promise<void> | void;
	onRequest( req: express.Request, res: express.Response ): Promise<void> | void;
}

export type ProgramCache = Map<string, SubRoute | null>;

export async function subRouteHandler(
	req: express.Request,
	res: express.Response,
	programCache: ProgramCache,
	programName: string,
	resolvePrefix: string
) {
	let program: SubRoute | undefined | null;

	if ( programCache.has( programName ) ) {
		program = programCache.get( programName );
		if ( program ) {
			try {
				return await program.onRequest( req, res );
			} catch ( error ) {
				winston.error( error );
				return internalServerError( req, res );
			}
		} else {
			return notFound( req, res );
		}
	}

	const moduleName = `@app/${ resolvePrefix }/${ programName }`;
	try {
		require.resolve( moduleName );
	} catch ( error ) {
		programCache.set( programName, null );
		return notFound( req, res );
	}

	try {
		program = await import( moduleName ) as SubRoute;
		await program.init?.();
	} catch ( error ) {
		winston.error( util.inspect( error ) );
		return internalServerError( req, res );
	}

	programCache.set( programName, program );
	try {
		await program.onRequest( req, res );
	} catch ( error ) {
		winston.error( util.inspect( error ) );
		internalServerError( req, res );
	} finally {
		if ( !res.writableEnded ) {
			res.end();
		}
	}
}
