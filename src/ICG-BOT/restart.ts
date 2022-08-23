import express = require( 'express' );
import fs = require( 'fs' );
import path = require( 'path' );
import util = require( 'util' );

export default function ( _req: express.Request, res: express.Response ) {
	fs.writeFile(
		path.join( String( process.env.ICG_BOT_ROOT ), '/reloadFlag.txt' ),
		'Reload require by website.\n\nDate: ' + new Date().toISOString(),
		function ( err ) {
			if ( err ) {
				res.status( 500 );
				res.type( 'text/plain' );
				res.send( util.format( err ) );
				res.end();
			} else {
				res.status( 200 );
				res.type( 'text/plain' );
				res.send( 'Success.' );
				res.end();
			}
		} );
}
