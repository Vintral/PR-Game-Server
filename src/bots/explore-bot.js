var Logger = require( '../logger' );
var Bot = require( './bot' );

class ExploreBot extends Bot {
	constructor( $id, $database ) {
		super( $id, $database );

		this._debug = true;
	}	
	
	async run() {
		this.debug( "run" );
		
		await this.load();
		if( this.turns > 0 ) {
			/*let result = await this.needLand();		
			if( result ) await this.run();*/
			
			await this.explore( this.turns );
			return await this.run();
		}
	}
		
	debug( $msg ) {
		if( this._debug )
			Logger.logBot( "ExploreBot(" + this.id + "): " + $msg );
		
		//Logger.logBot( $msg );
	}
}

module.exports = ExploreBot;