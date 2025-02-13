var Logger = require( '../logger' );
var BuildingManager = require( '../building-manager' );
var Bot = require( './bot' );
var delay = require( 'delay' );

class BuilderBot extends Bot {
	constructor( $id, $database ) {
		super( $id, $database );

		this._debug = false;
	}

	async run() {
		if( this.constructor.name == "BuilderBot" ) this.debug( "run" );		
		
		await this.load();		
		if( this.turns > 0 ) {			
			let result = await this.validateIncomes();
			if( result ) {
				this.debug( "Incomes Valid" );
				var building = this.pickBuilding();
				
				let result = await this.buildBuilding( building );
				if( !result ) return;		
			}
			
			return await this.run();
		}
		/*if( this.turns > 0 ) {
			if( this.food + this.foodtick < 0 ) {
				let result = await this.needFood();
				if( !result ) return;
			} else {
				if( this.landFree < 1 ) {					
					let result = await this.needLand();
					if( !result ) return;
				} else {				
					var building = this.pickBuilding();
					let result = await this.buildBuilding( building );
					if( !result ) return;
					else await this.load();					
				}
			}
			
			await this.run();
		}*/
	}
	
	async buildBuilding( $id, $quantity ) {
		this.debug( "buildBuilding: " + $id + ( $quantity ? ":" + $quantity : "" ) );	
		
		this.debug( "Wood: " + this.wood );
		this.debug( "Stone: " + this.stone );
		
		if( this.turns == 0 ) { this.debug( "No turns" ); return false; }

		const building = await BuildingManager.getBuildingByID( $id );
		if( !building ) {
			Logger.logError( "Invalid Building: " + $id );
			return false;
		}			
		
		var quantity = $quantity ? $quantity : Math.floor( this.buildPower / building.labor );
		if( quantity < 1 ) quantity = 1;
				
		if( this.landFree < 1 ) return await this.needLand();
		if( this.landFree < ( quantity / 2 ) ) { this.debug( "Need Land" ); return await this.needLand(); }
		if( this.landFree < quantity ) quantity = Math.floor( this.landFree );
		
		if( this.params.building_caps && this.params.building_caps[ building.id ] ) {			
			for( var b in this.buildings ) {
				if( this.buildings[ b ].type == building.type ) {
					if( this.buildings[ b ].quantity + quantity >= this.params.building_caps[ building.id ] ) {
						quantity = this.params.building_caps[ building.id ] - this.buildings[ b ].quantity;
						break;
					}
				}
			}
		}		
		if( quantity <= 0 ) { return false; }
		
		let wood =  Math.ceil( quantity * building.wood );
		let stone =  Math.ceil( quantity * building.stone );
		let stoneOld = this.stone;
		let woodOld = this.wood;
		
		if( this.wood < wood ) return await this.needWood( wood - this.wood );
		if( this.stone < stone ) return await this.needStone( stone - this.stone );
		
		this.debug( "Required Wood: " + wood );
		this.debug( "Required Stone: " + stone );
		
		//this.debug( this.turns + " : " + this.landFree + " : " + this.wood + " : " + this.stone + " : " + this.gold );
		
		if( Math.ceil( building.labor / this.buildPower ) > this.turns ) {
			this.debug( "Not enough turns" );
			return false;
		} else {
			this.buildCalls++;
			this.debug( "Calling build" );					
			let result = await this.build( building.type, quantity );
			if( result ) {
				this.built++;				
				this.buildingFailed = false;			
			}
			else {
				this.debug( "Wood Check: " + this.wood + " > " + wood + "? " + ( this.wood > wood ) );
				this.debug( "Stone Check: " + this.stone + " > " + stone + "? " + ( this.stone > stone ) );
				return false;
				this.buildFailed++;
				if( this.buildingFailed ) {
					this.buildingFailed = false;
					return false;
				}
				
				this.buildingFailed = true;				
				await this.buildBuilding( $id, $quantity );				
			}
						
			return result;					
		}
	}

	pickBuilding() {
		this.debug( "pickBuilding", false, true );

		var ret = 0;
		var min = -1;

		var buildingData = [];
		buildingData[ 0 ] = { id:1, quantity:0 };
		buildingData[ 1 ] = { id:5, quantity:0 };
		buildingData[ 2 ] = { id:3, quantity:0 };
		buildingData[ 3 ] = { id:4, quantity:0 };
		buildingData[ 4 ] = { id:8, quantity:0 };
		buildingData[ 5 ] = { id:6, quantity:0 };
		buildingData[ 6 ] = { id:7, quantity:0 };
		buildingData[ 7 ] = { id:2, quantity:0 };	
				
		for( var i = 0; i < this.buildings.length; i++ ) {
			var building = this.buildings[ i ];
			switch( building.type ) {
				case "farm": buildingData[ 0 ] = { id:1, quantity:building.quantity }; break;
				case "housing": buildingData[ 1 ] = { id:5, quantity:building.quantity }; break;
				case "mill": buildingData[ 2 ] = { id:3, quantity:building.quantity }; break;
				case "quarry": buildingData[ 3 ] = { id:4, quantity:building.quantity }; break;
				case "mine": buildingData[ 4 ] = { id:8, quantity:building.quantity }; break;
				case "wall": buildingData[ 5 ] = { id:6, quantity:building.quantity }; break;
				case "workshop": buildingData[ 6 ] = { id:7, quantity:building.quantity }; break;
				case "barracks": buildingData[ 7 ] = { id:2, quantity:building.quantity }; break;
			}
		}					

		//If we have no income, return that building type
		if( this.foodincome * 1.05 <= this.foodupkeep ) { this.debug( "We need farms", false, true ); return 1; }
		if( ( this.goldincome * 1.05 <= this.goldupkeep ) && ( this.population / this.population_max >= .95 ) ) { this.debug( "We need gold" ); return 5; }
		if( this.woodtick <= 0 ) { this.debug( "We need lumber mills", false, true ); return 3; }
		if( this.stonetick <= 0 ) { this.debug( "We need quarries", false, true ); return 4; }
		if( this.metaltick <= 0 ) { this.debug( "We need mines", false, true ); return 8; }
	
		var scalars;
		if( this.params && this.params.building_scalars ) {
			scalars = this.params.building_scalars;
		} else {
			scalars = {};
			scalars[ 0 ] = 1;
			scalars[ 1 ] = 2;
			scalars[ 2 ] = 1;
			scalars[ 3 ] = 1;
			scalars[ 4 ] = 1;
			scalars[ 5 ] = 10;
			scalars[ 6 ] = 30;
			scalars[ 7 ] = 30;
		}

		var minScalar = 0;
		for( var i = 0; i < buildingData.length; i++ ) {
			var building = buildingData[ i ];
			var scalar = 1;

			if( ( building.quantity * scalars[ building.id ] < min ) || ( min == -1 ) ) {				
				if( this.params.building_caps && this.params.building_caps[ building.id ] <= building.quantity ) {					
					continue;
				}
				if( building.id == 5 && ( this.population / this.population_max <= .95 ) ) continue;
				
				minScalar = scalars[ building.id ];
				min = building.quantity * scalars[ building.id ];
				ret = building.id;
			} else if( building.quantity * scalars[ building.id ] == min && scalars[ building.id ] < minScalar ) {
				minScalar = scalars[ building.id ];
				min = building.quantity * scalars[ building.id ];
				ret = building.id;
			}
		}

		return ret;		
	}

	debug( $msg, $force ) {
		if( this._debug || $force )
			Logger.logBot( "BuilderBot(" + this.id + "): " + $msg );
	}
}

module.exports = BuilderBot;
