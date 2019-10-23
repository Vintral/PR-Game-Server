var	colors = require('colors');
var Logger = require( './logger' );

class Building {	
	constructor( $id, $db ) {
		this._debug = true;
		
		this.id = $id;
		this._database = $db;
		
		this.type = "";
		this.name = "";
		this.plural = "";
		
		this.costWood = 0;
		this.costStone = 0;
		this.costPoints = 0;

		this.label = 0.00;
		
		this.field = "";
		this.bonus = 0.00;
		
		this.available = false;
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
			
			this.data = await this._database.getOne( "SELECT * FROM buildings WHERE id = " + this.id + " LIMIT 1" );						
			this.parseData();
		}
	}
	
	parseData() {
		if( this.data ) {
			this.type = this.data.type;
			this.name = this.data.name;
			this.plural = this.data.plural;
			
			this.costWood = parseInt( this.data.cost_wood );
			this.costStone = parseInt( this.data.cost_stone );
			this.costPoints = parseFloat( this.data.cost_points );
			
			this.field = this.data.field;
			this.bonus = parseFloat( this.data.bonus );
			
			this.available = this.data.available;
		}
	}
	
	clone() {
		var ret = new Building( this.id );
		
		ret.data = this.data;
		ret.parseData();
		ret.database = this.database;
		delete ret.data;
		
		return ret;
	}

	debug( $msg ) {
		if( this._debug ) 
			console.log( "Building: " + $msg );
	}
}


module.exports = Building;