var Logger = require( '../logger' );
var ExploreBot = require( './explore-bot' );
var BuilderBot = require( './builder-bot' );
var RecruiterBot = require( './recruiter-bot' );
var MarketBot = require( './market-bot' );
var WarBot = require( './war-bot' );
var BehaviorBot = require( './behavior-bot' );

class BotManager {
	constructor() {
		this._debug = false;
		this.debug( "Created" );

		this.ready = false;
		this.bots = [];	
	}

	set database( $db ) {
		this.db = $db;
	}

	async runBot( $bot ) {
		await this.bots[ i ].exeute();
	}
	async runBots() {
		if( !this.ready ) { this.debug( "Bots Not Ready" ); return; }
		
		this.ready = false;
		
		var self = this;
		if( this.timer ) clearTimeout( this.timer );
		this.timer = setTimeout( function() { self.ready = true; }, 300000 );
		
		this.debug( "runBots" );	
		 
		let start = new Date().getTime();
		for( var i = 0; i < this.bots.length; i++ ) {
			//let connection = await this.db.beginTransaction();
			//await connection.query( "UPDATE users_rounds SET energy = 25 WHERE userid = " + this.bots[ i ].id );
			//await this.db.commit( connection );
			
			Logger.logBot( "Starting bot: " + this.bots[ i ].id );
			await this.bots[ i ].execute();
			Logger.logBot( "Done Processing: " + this.bots[ i ].id );
			Logger.logBot( "Energy: " + this.bots[ i ].energy );
		}
		let finish = new Date().getTime();
		
		this.ready = true;
		this.debug( "runBots: Took " + ( ( finish - start ) / 1000 ) + " seconds" );
	}

	async clearBotData() {
		this.debug( "clearBotData" );		
		
		const connection = await this.db.beginTransaction();
				
		await connection.query( "DELETE FROM metric_energy_log WHERE roundid >= 18" );		
		for( var i = 0; i < this.bots.length; i++ ) {
			await connection.query( "DELETE FROM users_rounds WHERE userid = " + this.bots[ i ].id );
			await connection.query( "DELETE FROM users_rounds_buildings WHERE userid = " + this.bots[ i ].id );
			await connection.query( "DELETE FROM users_rounds_units WHERE userid = " + this.bots[ i ].id );
			await connection.query( "DELETE FROM users_log WHERE userid = " + this.bots[ i ].id );
			
			this.debug( "Cleared bot: " + this.bots[ i ].id );
		}		
		this.db.commit( connection );			
	}

	async spawnBots( clear ) {
		this.debug( "SpawnBots" );

		const bots = await this.db.get( "SELECT userid, type, active FROM users_bots WHERE userid >= 4 AND userid <= 34" );
		for( var i = 0; i < bots.length; i++ ) {
			var bot = bots[ i ];

			if( !bot.active ) continue;
			
			switch( bot.type ) {
				case "explorer": this.bots.push( new ExploreBot( bot.userid, this.db ) ); break;
				case "builder":	this.bots.push( new BuilderBot( bot.userid, this.db ) ); break;
				case "market": this.bots.push( new MarketBot( bot.userid, this.db ) ); break;
				case "recruiter": this.bots.push( new RecruiterBot( bot.userid, this.db ) ); break;
				case "war": this.bots.push( new WarBot( bot.userid, this.db ) ); break;
				case "behavior": this.bots.push( new BehaviorBot( bot.userid, this.db ) ); break;
				default: self.debug( "Invalid Bot Type: " + bot.type ); break;
			}
		}
		
		if( clear ) 
			await this.clearBotData();

		this.ready = true;
	}

	debug( $msg ) {
		if( this._debug )
			Logger.logBot( "BotManager: " + $msg );
	}
}

module.exports = new BotManager();
