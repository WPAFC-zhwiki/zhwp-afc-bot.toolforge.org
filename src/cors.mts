import express from 'express';

export default function corsHandler(
	request: express.Request,
	response: express.Response,
	next: express.NextFunction
) {
	const requestHeaderOrigin = request.headers.origin;
	const requestParametersOrigin = request.query.origin;

	if ( !requestParametersOrigin ) {
		next();
	} else if ( requestHeaderOrigin === requestParametersOrigin ) {
		response.setHeader( 'Access-Control-Allow-Origin', requestParametersOrigin );
		response.setHeader( 'Access-Control-Allow-Methods', 'GET, POST' );
		response.setHeader( 'Access-Control-Allow-Headers', 'Content-Type' );
		response.setHeader( 'Vary', 'Origin' );
		next();
	} else {
		response.status( 403 ).send( '\'origin\' parameter does not match Origin header' ).end();
	}
}
