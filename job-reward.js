var	colors = require('colors');
var Logger = require( './logger' );
var Security = require( './security' );

class JobReward {	
	constructor( $id, $db ) {
		this._debug = true;
		
		this.id = $id;
		this._database = $db;
		
		this.text = "";
		this.image = "";
		this.field = "";
		this.amount = 0;			
		
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
			
			this.data = await this._database.getOne( "SELECT * FROM job_rewards WHERE id = " + this.id + " LIMIT 1" );						
			this.parseData();
		}
	}
	
	parseData() {
		if( this.data ) {
			this.text = this.data.type;
			this.image = this.data.name;
			this.field = this.data.description;
			this.amount = this.data.effect;					
			
			this.available = this.data.available;					
		}
	}
	
	clone() {
		var ret = new JobReward( this.id );
		
		ret.data = this.data;
		ret.parseData();
		ret.database = this.database;
		delete ret.data;
		
		return ret;
	}

	debug( $msg ) {
		if( this._debug ) 
			console.log( "JobReward: " + $msg );
	}
}


module.exports = JobReward;