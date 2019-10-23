var	colors = require('colors');
var Logger = require( './logger' );
var Unit = require( './unit' );
var	EventEmitter = require("events").EventEmitter;

class UnitManager extends EventEmitter {	
	constructor() {
		super();
		this.debug( "Created" );			
	}	

	static set database( $db ) {	
		this.debug( "Set Database" );
		
		this._database = $db;
		this.loadUnits();			
	}	
	
	static onUnitsUpdated() {
		this.debug( "onUnitsUpdated" );
		this.loadUnits();
	}
	
	static async loadUnits() {
		this.debug( "loadUnits" );
		if( this._database ) {
			const units = await this._database.get( "SELECT id FROM units" );
			
			let unitsByID = [];
			let unitsByType = [];
			var unit;
			for( var u in units ) {
				unit = new Unit( units[ u ].id, this._database );
				await unit.load();
				
				unitsByID[ unit.id ] = unit;
				unitsByType[ unit.type ] = unit;				
			}					
			
			this.unitsByID = unitsByID;
			this.unitsByType = unitsByType;
		}
	}	
	
	static Update() {
		this.debug( "Update" );
		this.loadUnits();
	}
	
	static getUnitByType( $unit ) {
		//this.debug( "getUnitByType: " + $unit );
		
		if( this.unitsByType[ $unit ] )
			return this.unitsByType[ $unit ].clone();
	}
	
	static getUnitByID( $unit ) {
		//this.debug( "getUnitByID: " + $unit )
		if( this.unitsByID[ $unit ] )
			return this.unitsByID[ $unit ].clone();
	}
	
	static debug( $msg ) {
		Logger.logServer( "UnitManager: " + $msg );
	}
}

module.exports = UnitManager;