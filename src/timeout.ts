import * as utils from '@app/utils';
import express = require( 'express' );
import util = require( 'util' );
import winston = require( 'winston' );

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

export default function ( req: express.Request, res: express.Response, next: express.NextFunction ) {
	req.isTimeOut = false;

	const timeout = setTimeout( function () {
		if ( res.writableEnded ) {
			winston.warn( util.inspect( new Error( 'Unhandled timeout.' ) ) );
			return;
		}
		req.emit( 'timeout' );
		if ( !res.hasTimeoutResponse ) {
			utils.timeOut( req, res );
		}
	}, 60000 );

	req.clearTimeout = function () {
		clearTimeout( timeout );
	};

	res.on( 'finish', function () {
		req.clearTimeout();
	} );

	// @ts-expect-error TS2322
	res.writeHead = function ( ...args: Parameters<express.Response[ 'writeHead' ]> ) {
		req.clearTimeout();
		return express.response.writeHead.apply( this, args );
	};

	res.hasTimeoutResponse = false;

	next();
}
