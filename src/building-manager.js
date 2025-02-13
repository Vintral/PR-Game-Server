var	colors = require('colors');
var Building = require( './building' );
var	EventEmitter = require("events").EventEmitter;

import dbase from './database';
import logger from './logger';

class BuildingManager extends EventEmitter {	
	constructor() {
		super();
		this.debug( "Created" );			
	}
	
	static onBuildingsUpdated() {
		this.debug( "onBuildingsUpdated" );
		this.loadBuildings();
	}
	
	static async loadBuildings() {
		this.debug( "loadBuildings" );
		
		if( dbase ) {
			const buildings = await dbase.get( "SELECT id FROM buildings" );
			
			let buildingsByID = [];
			let buildingsByType = [];
			var building;
			for( var b in buildings ) {
				building = new Building( buildings[ b ].id, dbase );
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
		logger.logServer( "BuildingManager: " + $msg );
	}
}

module.exports = BuildingManager;