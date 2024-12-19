import express from 'express';
import { hsts } from 'helmet';

const hstsReps = hsts( {
	maxAge: 31_536_000,
	includeSubDomains: false,
	preload: false,
} );

export default function hstsHandler(
	request: express.Request,
	response: express.Response,
	next: express.NextFunction
) {
	if (
		request.protocol === 'https' ||
		request.headers[ 'x-forwarded-proto' ] === 'https'
	) {
		hstsReps( request, response, next );
	} else {
		next();
	}
}
