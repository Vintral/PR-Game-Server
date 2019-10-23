var	colors = require('colors');
var Logger = require( './logger' );

class Unit {	
	constructor( $id, $db ) {
		this._debug = true;
		
		this.id = $id;
		this._database = $db;
		
		this.type = "";
		this.name = "";
		this.plural = "";
		this.attack = 0.00;
		this.defense = 0.00;
		this.power = 0.00;
		this.health = 0;
		this.ranged = false;
		this.costGold = 0.00;
		this.costPoints = 0.00;
		this.upkeepGold = 0.00;
		this.upkeepFood = 0.00;
		this.upkeepWood = 0.00;
		this.upkeepFaith = 0.00;
		this.upkeepStone = 0.00;
		this.upkeepMana = 0.00;
		
		this.available = false;
		this.recruitable = false;
	}
	
	//======================//
	//	Accessors			//
	//======================//
	get database() {
		return this._database;
	}
	
	set database( $database ) {
		this._database = $database;
	}
	
	//======================//
	//	Methods				//
	//======================//
	async load() {
		if( this._database ) {
			this.debug( "load" );
			
			this.data = await this._database.getOne( "SELECT * FROM units WHERE id = " + this.id + " LIMIT 1" );						
			this.parseData();
		}
	}
	
	parseData() {
		if( this.data ) {
			this.type = this.data.type;
			this.name = this.data.name;
			this.plural = this.data.plural;
			
			this.ranged = this.data.ranged;
			this.attack = parseFloat( this.data.attack );
			this.defense = parseFloat( this.data.defense );
			this.power = ( this.attack + this.defense ) / ( 1 + ( this.ranged ? 1 : 0 ) );
			
			this.health = parseInt( this.data.health );						
			
			this.costGold = parseInt( this.data.cost_gold );
			this.costPoints = parseInt( this.data.cost_points );
			
			this.upkeepGold = parseFloat( this.data.upkeep_gold );
			this.upkeepFood = parseFloat( this.data.upkeep_food );
			this.upkeepWood = parseFloat( this.data.upkeep_wood );
			this.upkeepStone = parseFloat( this.data.upkeep_stone );
			this.upkeepFaith = parseFloat( this.data.upkeep_faith );
			this.upkeepMana = parseFloat( this.data.upkeep_mana );
			
			this.available = this.data.available;
			this.recruitable = this.data.recruitable;					
		}
	}
	
	clone() {
		var ret = new Unit( this.id );
		
		ret.data = this.data;
		ret.parseData();
		ret.database = this.database;
		delete ret.data;
		
		return ret;
	}

	debug( $msg ) {
		if( this._debug ) 
			Logger.logServer( "Unit: " + $msg );
	}
}
/*(function Unit() {
	this.debug( "Created" );
}

Unit.prototype.load = function( dbase ) {
	this.debug( "load" );
}

Unit.prototype.debug = function( msg ) {
	Logger.logServer( "Unit: " + msg );
}*/

module.exports = Unit;