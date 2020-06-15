var	colors = require('colors');
var scheduler = require( 'node-schedule' );
var User = require( './user' );
//var Bot = require( './bot' );

import logger from './logger';
import dbase from './database';

var BotManager = require( './bots/bot-manager' );

class CronManager {
	constructor( $users ) {		
		this.debug( "Cron Manager Created" );			

        this.users = $users;
        		
		BotManager.spawnBots();
		setTimeout( function() { BotManager.runBots(); }, 1000 );
		setTimeout( function() { BotManager.runBots(); }, 4000 );

		this.createCrons();
	}
	
	async test() {
		var connection = await dbase.getConnection();
		console.log( "HAVE CONNECTION" );		
		var result = await connection.query( "SELECT id FROM users LIMIT 1" );
		console.log( result );
		connection.release();
	}

	async minuteCron() {
		logger.logServer( "Running Cron: 1" );	
			
		//const result = await dbase.execute( "UPDATE users_rounds SET energy = energy + 10 WHERE energy <= 240" );		
		setTimeout( function() { BotManager.runBots(); }, 4000 );
		
		const expired = await dbase.get( "SELECT id FROM rounds WHERE expires < UNIX_TIMESTAMP() AND processed = 0" );
		//console.log( "Expired: " + expired );
		
		for( var u in this.users ) {
			if( this.users[ u ] ) {
				//logger.logServer( "Update User: " + u );
				//this.users[ u ].user.update( expired );				
			}
		}
	}
	
	createCrons() {
		var self = this;
		scheduler.scheduleJob( "*/1 * * * *", function() { self.minuteCron(); } );
		
		//scheduler.scheduleJob( "*/1 * * * *", async function() {
			/*setTimeout( function() {
				logger.logServer( "Running Cron: 1" );

				console.log( this );
				console.log( self );
				const result = await self.database.execute( "UPDATE users_rounds SET energy = energy + 10 WHERE energy <= 240" );
				//BotManager.runBots();
				
				const expired = await self.database.get( "SELECT id FROM rounds WHERE expires < UNIX_TIMESTAMP() AND processed = 0" );
				
				for( var u in self.users ) {
					if( self.users[ u ] ) {
						logger.logServer( "Update User: " + u );
						self.users[ u ].update( expired );
					}
				}
				
				/*self.database.executeQuery( "SELECT id FROM rounds WHERE expires < UNIX_TIMESTAMP() AND processed = 0", function( result ) {
					//console.log( "Expired: " + result );

					var expired = [];
					for( var i in result ) {
						expired.push( result[ i ].id );
					}

					for( var u in self.users ) {
						if( self.users[ u ] ) {
							logger.logServer( "Update User: " + u );
							self.users[ u ].update( expired );
						}
					}
				} );*/
			//}, 5000 );


			/*elf.database.executeQuery( "SELECT * FROM users_rounds WHERE population > population_max", function( overpopulated ) {
				if( overpopulated && overpopulated.length >= 1 ) {
					for( var o in overpopulated ) {
						var pop = overpopulated[ o ].population;
						var max = overpopulated[ o ].population_max;

						var user = new User();
						user.database = self.database;
						user.on( "LOADED", function() {
							console.log( this.id + " has " + pop + " and a max of " + max );
							this.losePopulation( this.population - this.population_max );
						} );
						user.loadById( overpopulated[ o ].userid, overpopulated[ o ].roundid );
					}
				}
			} );*/

			/*database.executeQuery( "DELETE FROM market_quotes WHERE time < UNIX_TIMESTAMP() - 300" );

			if( users[ 2 ] ) {
				logger.logServer( "Send Event" );
				users[ 2 ].connection.emit( "NEW_EVENT", { data:"Test" } );
			} else logger.logServer( "Test User Not Connected" );*/
		//} );

		scheduler.scheduleJob( "*/5 * * * *", function() {
			logger.logServer( "Running Cron: 5" );

			//var bot = new Bot( 5, self.database );
			/*self.database.executeQuery( "UPDATE users_rounds SET food = food + ( food_income - food_upkeep ), stone = stone + ( stone_income - stone_upkeep ), wood = wood + ( wood_income - wood_upkeep ), faith = faith + ( faith_income - faith_upkeep ), mana = mana + ( mana_income - mana_upkeep ), gold = gold + ( gold_income - gold_upkeep )", function( results ) {
				if( !results || results.affectedRows < 1 )
					logger.logError( "Cron(5): Error updating users" );
			} );*/
		} );

		logger.logServer( "Crons Created" );	
	}
	
	debug( $msg ) {
		logger.logServer( $msg );
	}
}

module.exports = function( $users ) {
	new CronManager( $users );
}
