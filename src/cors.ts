import express = require( 'express' );

export default function ( req: express.Request, res: express.Response, next: () => void ) {
	const reqHeaderOrigin = req.headers.origin;
	const reqParamsOrigin = req.query.origin;

	if ( !reqParamsOrigin ) {
		next();
	} else if ( reqHeaderOrigin !== reqParamsOrigin ) {
		res.status( 403 ).send( '\'origin\' parameter does not match Origin header' ).end();
	} else {
		res.setHeader( 'Access-Control-Allow-Origin', reqParamsOrigin );
		res.setHeader( 'Access-Control-Allow-Methods', 'GET, POST' );
		res.setHeader( 'Access-Control-Allow-Headers', 'X-Requested-With,content-type' );
		next();
	}
}
