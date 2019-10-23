var	colors = require('colors');
var Logger = require( './logger' );
var Security = require( './security' );

class Item {	
	constructor( $id, $db ) {
		this._debug = false;
		
		this.id = $id;
		this._database = $db;
		
		this.type = "";
		this.name = "";
		this.level = "";
		this.description = "";		
		this.effect = "";
		
		this.onUse = "";
		
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
			
			this.data = await this._database.getOne( "SELECT * FROM items WHERE id = " + this.id + " LIMIT 1" );						
			this.parseData();
		}
	}
	
	parseData() {
		if( this.data ) {
			this.type = this.data.type;
			this.name = this.data.name;
			this.description = this.data.description;
			this.effect = this.data.effect;
			this.level = this.data.level;
			
			this.onUse = Security.decrypt( this.data.onUse );

			console.log( this.onUse );
			
			this.available = this.data.available;					
		}
	}
	
	clone() {
		var ret = new Item( this.id );
		
		ret.data = this.data;
		ret.parseData();
		ret.database = this.database;
		delete ret.data;
		
		return ret;
	}

	debug( $msg ) {
		if( this._debug ) 
			console.log( "Item: " + $msg );
	}
}


module.exports = Item;