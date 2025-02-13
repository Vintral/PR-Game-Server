var Logger = require( '../logger' );
var RecruiterBot = require( './recruiter-bot' );
var UnitManager = require( '../unit-manager' );

class WarBot extends RecruiterBot {
	constructor( $id, $database ) {
		super( $id, $database );
		
		this._debug = true;
		this.errors = 0;
		
		this.attacks = 0;
	}	
	
	async run() {
		if( this.constructor.name == "WarBot" ) this.debug( "run" );
		
		await super.run();
		return;
		
		await this.load();
		this.debug( "Turns: " + this.turns );
		
		//this.attacks++;
		if( this.attacks >= 10 ) {
			this.attacks = 0;
			return;
		}			
		
		//Make sure we're not going broke
		let result = await this.validateIncomes();
		if( result ) {
			/*let target = await this.findTarget();
			if( target == -1 ) {
				return await super.run();
			}
			else {
				let result = await this.attack( target );
				if( result ) return await this.run();
				else await super.run();
			}*/
			await super.run();
		} else await super.run();				
	}	
	
	async findTarget() {
		//this.debug( "findTarget" );
		
		let targets = await this.database.get( "SELECT username, userid, power, land FROM users_rounds INNER JOIN users ON userid = users.id WHERE power >= " + Math.ceil( this.power / 2 ) + " AND power <= " + ( this.power * 2 ) + " AND roundid = " + this.currentRound + " AND userid <> " + this.id + " ORDER BY land DESC" );
		if( targets.length == 0 ) return -1;

		let armyPower = this.power - ( this.land * 5 );
		let best = "";		
		
		for( let t in targets ) {
			let target = targets[ t ];
			target.land = parseFloat( target.land );
			target.armyPower = target.power - ( target.land * 5 );
			target.ratio = target.armyPower / armyPower;
		
			if( target.ratio < 1 && ( !best || best.ratio > target ) ) 
				best = target
		}			
				
		return best ? best.username : -1;
	}
	
	debug( $msg, $force, $silence ) {
		if( $silence ) return;		
		if( this._debug || $force )
			Logger.logBot( "WarBot(" + this.id + "): " + $msg );			
	}
}

module.exports = WarBot;