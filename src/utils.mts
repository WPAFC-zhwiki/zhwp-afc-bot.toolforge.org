import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { format, inspect } from 'node:util';

import express from 'express';
import expressPackageJson from 'express/package.json' with { type: 'json' };
import type { SendFileOptions } from 'express-serve-static-core';
import winston from 'winston';

import packageJson from '../package.json' with { type: 'json' };

export const origin = process.env.SERVER_ORIGIN || 'https://zhwp-afc-bot.toolforge.org';
export const userAgent = process.env.REQUEST_USER_AGENT || `zhwp-afc-bot-web/${ packageJson.version } (${ packageJson.repository.replace( /^git+/, '' ) })`;

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

type JSONResponseApiVersion = number;

function renderDefaultPage(
	code: number,
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion,
	args: Record<string, string> = {},
	errorTemplate: string = String( code )
) {
	if ( useJson ) {
		const responseJson: Record<string, unknown> = {
			status: code,
			code: errorTemplate === String( code ) ? undefined : errorTemplate,
		};
		if ( typeof useJson === 'number' ) {
			responseJson.apiVersion = useJson;
		}
		response.json( responseJson );
	} else {
		const pathname = new URL( request.originalUrl, origin ).pathname;
		response.render( 'status/' + errorTemplate, {
			expressVersion: expressPackageJson.version,
			method: request.method.toUpperCase(),
			pathname,
			...args,
		} );
	}
}

export function rewriteUrl( newPrefix: string ) {
	return function ( request: express.Request, response: express.Response ) {
		movedPermanently( newPrefix + request.url, request, response );
	};
}

export function movedPermanently( location: string, request: express.Request, response: express.Response ) {
	response.status( 301 );
	response.set( 'Location', mayEncodeAbsoluteURI( location ) );
	renderDefaultPage( 301, request, response, /** useJson */ false, {
		location,
	} );
	response.end();
}

export function badRequest(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 400 );
	renderDefaultPage( 400, request, response, useJson );
	response.end();
}

export function forbidden(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 403 );
	renderDefaultPage( 403, request, response, useJson );
	response.end();
}

export function notFound(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 404 );
	renderDefaultPage( 404, request, response, useJson );
	response.end();
}

export function methodNoAllow(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 405 );
	renderDefaultPage( 405, request, response, useJson );
	response.end();
}

export function replicaAccessDisabled(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 422 );
	renderDefaultPage( 422, request, response, useJson, {}, '422-replica-access-disabled' );
	response.end();
}

export function internalServerError(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 500 );
	renderDefaultPage( 500, request, response, useJson );
	response.end();
}

export function badGateway(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 502 );
	renderDefaultPage( 502, request, response, useJson );
	response.end();
}

export function unavailable(
	request: express.Request,
	response: express.Response,
	useJson: boolean | JSONResponseApiVersion = false
) {
	response.status( 503 );
	renderDefaultPage( 503, request, response, useJson );
	response.setHeader( 'Retry-After', 120 );
	response.end();
}

export function timeOut( request: express.Request, response: express.Response ) {
	response.writeHead( 503, 'Request Timeout' );
	renderDefaultPage( 503, request, response, /** useJson #TODO */ false, {}, 'timeout' );
	response.setHeader( 'Retry-After', 600 );
	response.end();
}

export function sendFile( fileName: string, options: SendFileOptions = {} ) {
	options.maxAge = options.maxAge ?? 86_400;
	return async function ( _request: express.Request, response: express.Response ) {
		winston.debug( format( 'Send file %s (options: %o)......', fileName, options ) );
		response.status( 200 );
		await new Promise<void>( function ( resolve, reject ) {
			response.sendFile( fileName, options, function ( error ) {

				if ( error ) {
					reject( error );
				}
				resolve();
			} );
		} );
		response.end();
	};
}

export interface SubRoute {
	init?(): Promise<void> | void;
	deinit?(): Promise<void> | void;
	onRequest( request: express.Request, response: express.Response ): Promise<void> | void;
}

export type ProgramCache = Map<string, SubRoute | undefined>;

export async function subRouteHandler(
	request: express.Request,
	response: express.Response,
	programCache: ProgramCache,
	programName: string,
	resolvePrefix: string
) {
	let program: SubRoute | undefined | undefined;

	if ( programCache.has( programName ) ) {
		program = programCache.get( programName );
		if ( program ) {
			try {
				return await program.onRequest( request, response );
			} catch ( error ) {
				winston.error( error );
				return internalServerError( request, response );
			}
		} else {
			return notFound( request, response );
		}
	}

	const moduleName = `@app/${ resolvePrefix }/${ programName }${ path.extname( programName ) ? '' : '.mjs' }`;
	try {
		const realpath = import.meta.resolve( moduleName );
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		assert( fs.existsSync( new URL( realpath ) ) );
	} catch {
		programCache.set( programName, undefined );
		return notFound( request, response );
	}

	try {
		program = await import( moduleName ) as SubRoute;
		await program.init?.();
	} catch ( error ) {
		winston.error( inspect( error ) );
		return internalServerError( request, response );
	}

	programCache.set( programName, program );
	try {
		await program.onRequest( request, response );
	} catch ( error ) {
		winston.error( inspect( error ) );
		internalServerError( request, response );
	} finally {
		if ( !response.writableEnded ) {
			response.end();
		}
	}
}

export { type SendFileOptions } from 'express-serve-static-core';
