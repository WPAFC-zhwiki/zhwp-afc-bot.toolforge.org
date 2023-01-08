import express = require( 'express' );
import { hsts } from 'helmet';

const hstsReps = hsts( {
	maxAge: 31536000,
	includeSubDomains: false,
	preload: false
} );

export default function ( req: express.Request, res: express.Response, next: express.NextFunction ) {
	if (
		req.protocol === 'https' ||
		req.headers[ 'x-forwarded-proto' ] === 'https'
	) {
		hstsReps( req, res, next );
	} else {
		next();
	}
}
