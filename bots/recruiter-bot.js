var Logger = require( '../logger' );
var MarketBot = require( './market-bot' );
var UnitManager = require( '../unit-manager' );

class RecruiterBot extends MarketBot {
	constructor( $id, $database ) {
		super( $id, $database );
		
		this._debug = true;
		this.errors = 0;
	}	
	
	async run() {
		if( this.constructor.name == "RecruiterBot" ) this.debug( "run" );
				
		if( this.energy > 0 ) {
			this.debug( "Energy: " + this.energy );
			let result = await this.validateIncomes();
			if( result ) {
				this.debug( "Population: " + this.population + "/" + this.population_max );
				if( this.population / this.population_max < this.params.populationToRecruit ) { return await super.run(); }
				
				var unit = this.pickUnit();
				let result = await this.recruitUnit( unit );
				if( result ) return await this.run();
				else return await super.run();
			} else return await super.run();
		}
	}
	
	async recruitUnit( $id, $quantity ) {
		this.debug( "recruitUnit: " + $id + ( $quantity ? ":" + $quantity : "" ) );
		
		if( this.energy == 0 ) return false;
		
		let unit = UnitManager.getUnitByID( $id );
		if( !unit ) {
			Logger.logError( "No Unit Found For Bot: " + $id );
			return false;
		}		
				
		var quantity = $quantity ? $quantity : Math.floor( this.recruitPower / unit.costPoints );
		if( quantity < 1 ) quantity = 1;
		
		this.debug( "Quantity 1: " + quantity );

		if( ( ( this.population - quantity ) / this.population_max ) < this.params.populationToRecruit ) {
			quantity = Math.floor( this.population - ( this.population_max * this.params.populationToRecruit ) );
			quantity = 0;
		}		
		if( quantity <= 0 ) { return false; }

		this.debug( "Quantity 2: " + quantity );
				
		let costGold = quantity * unit.costGold;
		let upkeepGold = quantity * unit.upkeepGold;
		let costFood = quantity * unit.costFood;
		let upkeepFood = quantity * unit.upkeepFood;
		
		if( this.incomeGold - this.upkeepGold - upkeepGold <= 0 ) { this.debug( "Not enough gold income" ); return await this.buildBuilding( 5 ); }
		if( this.incomeFood - this.upkeepFood - upkeepFood <= 0 ) { this.debug( "Not enough food income" ); return await this.buildBuilding( 1 ); }
				
		this.debug( "Quantity 3: " + quantity );
		let result = await this.recruit( unit.type, quantity );
		if( result ) this.recruited++;
				
		return result;
	}
	
	pickUnit() {		
		var unitData = [];
		unitData[ 0 ] = { id:1, quantity:0 };
		unitData[ 1 ] = { id:2, quantity:0 };
		unitData[ 2 ] = { id:3, quantity:0 };
		unitData[ 3 ] = { id:4, quantity:0 };
		unitData[ 4 ] = { id:5, quantity:0 };
		
		if( this.units.length == 0 ) return 1;
		else {
			for( var i = 0; i < this.units.length; i++ ) {
				var unit = this.units[ i ];				
				switch( unit.type ) {
					case "peasant": unitData[ 0 ] = { id:1, quantity:unit.quantity }; break;
					case "footman": unitData[ 1 ] = { id:2, quantity:unit.quantity }; break;
					case "archer": unitData[ 2 ] = { id:3, quantity:unit.quantity }; break;
					case "cavalry": unitData[ 3 ] = { id:4, quantity:unit.quantity }; break;
					case "crusader": unitData[ 4 ] = { id:5, quantity:unit.quantity }; break;					
				}
			}
			
			var scalars;
			if( this.params && this.params.unit_scalars ) {
				scalars = this.params.unit_scalars;
			} else {
				scalars = {};
				scalars[ 0 ] = 2;
				scalars[ 1 ] = 6;
				scalars[ 2 ] = 8;
				scalars[ 3 ] = 14;
				scalars[ 4 ] = 22;					
			}
				
			var min = 0;
			var ret = 0;			
			for( var i = 0; i < unitData.length; i++ ) {
				var unit = unitData[ i ];
				var scalar = 1;
				
				if( unit.quantity == 0 ) return unit.id;
				
				if( unit.quantity * scalars[ unit.id ] < min || i == 0 ) {
					min = unit.quantity * scalars[ unit.id ];
					ret = unit.id;
				}
				
				//this.debug( "Val: " + min + " -- " + ( unit.quantity * scalar ) );
			}
			
			return ret;			
		}
	}	
	
	debug( $msg, $force, $silence ) {
		if( $silence ) return;		
		if( this._debug || $force )
			Logger.logBot( "RecruiterBot(" + this.id + "): " + $msg );			
	}
}

module.exports = RecruiterBot;