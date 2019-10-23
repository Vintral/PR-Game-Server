var	colors = require('colors');
var Logger = require( './logger' );
var Building = require( './building' );
var	EventEmitter = require("events").EventEmitter;

class BuildingManager extends EventEmitter {	
	constructor() {
		super();
		this.debug( "Created" );			
	}	

	static set database( $db ) {	
		this.debug( "Set Database" );
		
		this._database = $db;
		this.loadBuildings();			
	}	
	
	static onBuildingsUpdated() {
		this.debug( "onBuildingsUpdated" );
		this.loadBuildings();
	}
	
	static async loadBuildings() {
		this.debug( "loadBuildings" );
		
		if( this._database ) {
			const buildings = await this._database.get( "SELECT id FROM buildings" );
			
			let buildingsByID = [];
			let buildingsByType = [];
			var building;
			for( var b in buildings ) {
				building = new Building( buildings[ b ].id, this._database );
				await building.load();
				
				buildingsByID[ building.id ] = building;
				buildingsByType[ building.type ] = building;				
			}					
			
			this.buildingsByID = buildingsByID;
			this.buildingsByType = buildingsByType;
		}
	}	
	
	static Update() {
		this.debug( "Update" );
		this.loadBuildings();
	}
	
	static getBuildingByType( $building ) {
		if( this.buildingsByType[ $building ] )
			return this.buildingsByType[ $building ].clone();
	}
	
	static getBuildingByID( $building ) {
		if( this.buildingsByID[ $building ] )
			return this.buildingsByID[ $building ].clone();
	}
	
	static debug( $msg ) {
		Logger.logServer( "BuildingManager: " + $msg );
	}
}

module.exports = BuildingManager;