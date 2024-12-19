import { inspect } from 'node:util';

import express from 'express';
import winston from 'winston';

import * as utils from '@app/utils.mjs';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			clearTimeout(): void;

			isTimeOut: boolean;
		}

		interface Response {
			hasTimeoutResponse: boolean;
		}
	}
}

export default function timeoutHandler(
	request: express.Request,
	response: express.Response,
	next: express.NextFunction
) {
	request.isTimeOut = false;

	const timeout = setTimeout( function () {
		if ( response.writableEnded ) {
			winston.warn( inspect( new Error( 'Unhandled timeout.' ) ) );
			return;
		}
		request.emit( 'timeout' );
		if ( !response.hasTimeoutResponse ) {
			utils.timeOut( request, response );
		}
	}, 60_000 );

	request.clearTimeout = function () {
		clearTimeout( timeout );
	};

	response.on( 'finish', function () {
		request.clearTimeout();
	} );

	// @ts-expect-error TS2322
	response.writeHead = function ( ...args: Parameters<express.Response[ 'writeHead' ]> ) {
		request.clearTimeout();
		return express.response.writeHead.apply( this, args );
	};

	response.hasTimeoutResponse = false;

	next();
}
