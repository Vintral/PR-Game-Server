//var Security = require( './security' );

import logger from './logger';

class Item {	
	constructor( $id, $db ) {
		this._debug = false;
		
		this.id = $id;		
		
		this.type = "";
		this.name = "";
		this.level = "";
		this.description = "";		
		this.effect = "";
		
		this.onUse = "";
		
		this.available = false;
	}
	
	
	//======================//
	//	Methods				//
	//======================//
	async load() {
		if( dbase ) {
			this.debug( "load" );
			
			this.data = await dbase.getOne( "SELECT * FROM items WHERE id = " + this.id + " LIMIT 1" );						
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
			
			this.onUse = this.data.onUse;

			console.log( this.onUse );
			
			this.available = this.data.available;					
		}
	}
	
	clone() {
		var ret = new Item( this.id );
		
		ret.data = this.data;
		ret.parseData();		
		delete ret.data;
		
		return ret;
	}

	debug( $msg ) {
		if( this._debug ) 
			logger.logServer( "Item: " + $msg );
	}
}


module.exports = Item;