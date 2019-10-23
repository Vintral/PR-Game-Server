var Logger = require( '../logger' );
var BuildBot = require( './builder-bot' );

class RecruitBot extends BuilderBot {
	constructor( $id, $database ) {
		super( $id, $database );
		
		this._debug = true;
	}	
	
	run() {		
		/*this.debug( "run" );		
		
		if( this.food < this.foodtick ) {
			this.gather( "food", 1 );
		} else {
			if( this.landFree < 1 ) {
				this.once( "EXPLORED", this.onExplored );
				this.explore( 1 );
			} else {
				var self = this;
				this.once( "LOADED", function() {
					if( self.turns == 0 ) self.emit( "FINISHED" );
					else {
						var building = self.pickBuilding();				
						self.buildBuilding( building );
					}
				} );
				this.load();
			}
		}*/
	}
		
	
	debug( $msg, $force ) {
		if( this._debug || $force )
			console.log( "RecruitBot: " + $msg );			
	}
}

module.exports = RecruitBot;