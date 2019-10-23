var User = require( '../user' );
var Logger = require( '../logger' );

class Bot extends User {
	constructor( $id, $database ) {
		super();
		this.id = $id;
		this.database = $database;
		
		this.explored = 0;
		this.recruited = 0;
		this.built = 0;
		this.gathered = 0;
		this.attacked = 0;
		this.raided = 0;
		
		this.buildCalls = 0;
		this.buildFailed = 0;
		this.rounds = [];
	}
	
	async execute() {
		this.turnsExplored = 0;
		
		this.debug( "execute" );		
		await this.findRounds();
		
		/*if( this.debug ) {
			this.debug( "===================" );
			this.debug( "Explored: " + this.explored + " - " + this.turnsExplored );
			this.debug( "Gathered: " + this.gathered );
			this.debug( "Built: " + this.built + " -- " + this.buildCalls + " - " + this.buildFailed );
			this.debug( "Recruited: " + this.recruited );
			this.debug( "Attacked: " + this.attacked );
			this.debug( "Raided: " + this.raided );
			this.debug( "===================" );
		}*/
	}
	
	async explore( $turns ) {
		if( !$turns ) {
			$turns = this.params && this.params.turnsToExplore ? this.params.turnsToExplore : 1;
		}
		
		if( $turns <= 0 ) return false;
		
		return await super.explore( $turns );
	}
	
	async gather( $type, $turns ) {
		if( !$turns ) {
			$turns = this.params && this.params.turnsToGather ? this.params.turnsToGather : 1;
		}
		
		if( $turns <= 0 ) return false;	
		
		return await super.gather( $type, $turns );
	}	
	
	async validateIncomes() {
		//If we're really low, gather
		if( this.food < this.foodupkeep * 1.5 ) { await this.needFood(); return false; }		
		if( this.gold < this.goldupkeep * 1.5 ) { await this.needGold(); return false; }		
		
		//If our incomes are low, build farms or housing
		if( this.foodupkeep > this.foodincome ) { await this.buildBuilding( 1 ); return false; }
		if( ( this.goldupkeep > this.goldincome ) && ( this.population / this.population_max >= .97 ) ) {			
			if( this.params && this.params.building_caps && this.params.building_caps[ 5 ] ) {
				var quantity = this.buildings.reduce( function( building, total ) {
					if( building.id == 5 ) return total += bolding.quantity;
					else return total;
				} );							
				
				if( quantity.quantity < this.params.building_caps[ 5 ] ) await this.buildBuilding( 5 );
				else { await this.needGold(); return false; }
			} else {
				await this.buildBuilding( 5 ); 
				return false; 
			}
		}
		
		return true;
	}

	async findRounds() {
		this.debug( "findRounds" );
		
		this.rounds = await this.database.get( "SELECT id FROM rounds WHERE active = 1" );		
		await this.processRounds();
	}	

	onNotInRound() {
		this.removeListener( "LOADED", this.process );
		this.removeListener( "NOT_IN_ROUND", this.onNotInRound );
		
		this.joinRound( this.currentRound );
		this.emit( "FINISHED" );
	}
	
	async needLand( $val ) {		
		let result = await this.explore();
		if( result ) this.explored++;		
		return result;
	}
	
	async needStone( $val ) {
		this.debug( "Gather Stone" );		
		let result = await this.gather( "stone" );
		if( result ) this.gathered++;
		return result;
	}
	
	async needWood( $val ) {
		this.debug( "Gather Wood" );		
		let result = await this.gather( "wood" );
		if( result ) this.gathered++;
		return result;
	}
	
	async needFood( $val ) {
		this.debug( "Gather Food", true );		
		let result = await this.gather( "food" );
		if( result ) this.gathered++;
		return result;
	}
	
	async needGold( $val ) {
		this.debug( "Gather Gold" );		
		let result = await this.gather( "gold" );
		if( result ) this.gathered++;
		return result;
	}
	
	onLoaded() {
		this.debug( "onLoaded Not Handled" );
	}
	
	async processRounds() {
		this.debug( "processRounds" );

		this.processing = false;
		
		while( this.rounds.length >= 1 ) {
			let round = this.rounds.shift();			
			
			this.currentRound = round.id;			
			await this.load();
			
			if( !this.land ) await this.joinRound( this.currentRound );
			else await this.run();
		}		
	}

	async process() {
		this.debug( "process" );
		
		if( this.processing ) {
			Logger.logError( "Trying to process again!" );			
			return;
		}
		
		this.processing = true;
		
		this.removeListener( "NOT_IN_ROUND", this.onNotInRound );
		
		this.debug( "process:" + this.id + ":" + this.currentRound );		

		let result = await this.database.getOne( "SELECT id FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );
		if( result ) {
			this.debug( "Turns: " + this.turns );
			if( this.turns > 0 ) {
				this.once( "FINISHED", function() { this.debug( "FINISHED" ); this.processRounds(); } );
				this.run();
			}
		} else {
			await this.joinRound( this.currentRound );
		}		
	}

	async run() {
		this.debug( "RUN NYI" );
	}

	async load() {
		this.debug( "load: " + this.currentRound );
				
		let data = await this.database.getOne( "SELECT username, email, current_round, avatar, gems, sex, users_bots.type AS bot, users_bots.params AS params FROM users LEFT JOIN users_bots ON users_bots.userid = users.id WHERE users.id = " + this.id + " LIMIT 1" );		
		this.username = data.username;
		this.email = data.email;
		this.avatar = data.avatar;
		this.gems = data.gems;
		this.sex = data.sex;
		this.bot = data.bot;
		this.params = JSON.parse( data.params );
				
		if( this.currentRound ) {
			data = await this.database.getOne( "SELECT * FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );
			if( !data ) {
				this.debug( "NOT IN ROUND" );
				this.emit( "NOT_IN_ROUND" );
				return;
			}
			
			this.removeListener( "NOT_IN_ROUND", this.onNotInRound );
			
			//Store the values in our current object
			this.gold = parseFloat( data.gold );
			this.land = parseFloat( data.land );
			this.landFree = parseFloat( data.land_free );
			this.food = parseFloat( data.food );
			this.mana = parseFloat( data.mana );
			this.wood = parseFloat( data.wood );
			this.metal = parseFloat( data.metal );
			this.stone = parseFloat( data.stone );
			this.faith = parseFloat( data.faith );
			this.turns = parseInt( data.turns );
			this.power = data.power;
			this.foodtick = parseFloat( data.food_income - data.food_upkeep );
			this.foodincome = parseFloat( data.food_income );
			this.foodupkeep = parseFloat( data.food_upkeep );
			this.goldtick = parseFloat( data.gold_income - data.gold_upkeep );
			this.goldincome = parseFloat( data.gold_income );
			this.goldupkeep = parseFloat( data.gold_upkeep );
			this.stonetick = parseFloat( data.stone_income - data.stone_upkeep );
			this.stoneincome = parseFloat( data.stone_income );
			this.faithtick = parseFloat( data.faith_income - data.faith_upkeep );
			this.faithincome = parseFloat( data.faith_income );
			this.manatick = parseFloat( data.mana_income - data.mana_upkeep );
			this.manaincome = parseFloat( data.mana_income );
			this.woodtick = parseFloat( data.wood_income - data.wood_upkeep );
			this.woodincome = parseFloat( data.wood_income );
			this.metaltick = parseFloat( data.metal_income - data.metal_upkeep );
			this.metalincome = parseFloat( data.metal_income );
			this.population = parseFloat( data.population );
			this.population_max = parseFloat( data.population_max );
			this.buildPower = data.build;
			this.defensePower = data.defense;
			this.recruitPower = data.recruit;
			this.loaded = true;					
			
			this.buildings = await this.database.get( "SELECT quantity, type FROM users_rounds_buildings INNER JOIN buildings ON buildingid = buildings.id WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " ORDER BY quantity DESC" );
			this.units = await this.database.get( "SELECT quantity, type FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + this.id + " AND roundid = " + this.currentRound );					
		}
	}

	debug( $msg ) {
		if( this._debug )
			this.debug( "Bot: " + $msg );
	}
}

module.exports = Bot;
