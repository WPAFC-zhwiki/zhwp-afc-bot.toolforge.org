import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

import express from 'express';

export default function restart( _request: express.Request, response: express.Response ) {
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	fs.writeFile(
		path.join( String( process.env.ICG_BOT_ROOT ), '/reloadFlag.txt' ),
		'Reload require by website.\n\nDate: ' + new Date().toISOString(),
		function ( error ) {
			if ( error ) {
				response.status( 500 );
				response.type( 'text/plain' );
				response.send( format( error ) );
				response.end();
			} else {
				response.status( 200 );
				response.type( 'text/plain' );
				response.send( 'Success.' );
				response.end();
			}
		} );
}
