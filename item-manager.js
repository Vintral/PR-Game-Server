var	colors = require('colors');
var Logger = require( './logger' );
var Item = require( './item' );
var	EventEmitter = require("events").EventEmitter;

class ItemManager extends EventEmitter {	
	constructor() {
		super();
		this.debug( "Created" );			
	}	

	static set database( $db ) {	
		this.debug( "Set Database" );
		
		this._database = $db;
		this.loadItems();			
	}
	
	static onItemsUpdated() {
		this.debug( "onItemsUpdated" );
		this.loadItems();
	}
	
	static async loadItems() {
		this.debug( "loadItems" );
		
		if( this._database ) {
			const items = await this._database.get( "SELECT id FROM items" );
			
			let itemsByID = [];
			let itemsAll = [];
			let itemsByType = [];
			let itemsByLevel = [];
			let item;
			for( let i in items ) {
				item = new Item( items[ i ].id, this._database );
				await item.load();
				
				itemsByID[ item.id ] = item;
				itemsByType[ item.type ] = item;
				
				if( !itemsByLevel[ item.level ] ) itemsByLevel[ item.level ] = [];				
				itemsByLevel[ item.level ].push( item );
				
				itemsAll.push( item );
			}					
			
			this.itemsByID = itemsByID;
			this.itemsByType = itemsByType;
			this.itemsByLevel = itemsByLevel;
			this.itemsAll = itemsAll;
		} else Logger.logError( "ItemManager doesn't have a database" );
	}

	static async getRandomItem( $level ) {
		this.debug( "getRandomItem: " + $level );
				
		if( this.itemsByLevel[ $level ] ) {
			this.debug( "exists: " + this.itemsByLevel[ $level ].length );
			let choice = Math.floor( Math.random() * this.itemsByLevel[ $level ].length );
			this.debug( "Choice: " + choice );
			return this.itemsByLevel[ $level ][ choice ];
		} else {
			this.debug( "Doesn't exist" );
			let choice = Math.floor( Math.random() * this.itemsAll.count );
			this.debug( "Choice: " + choice );
			return this.itemsAll[ choice ];
		}
		
		return this.itemsByID[ 1 ];
	}	
	
	static Update() {
		this.debug( "Update" );
		this.loadItems();
	}
	
	static getItemByType( $item ) {
		if( this.itemsByType[ $item ] )
			return this.itemsByType[ $item ].clone();
	}
	
	static getItemByID( $item ) {
		if( this.itemsByID[ $item ] )
			return this.itemsByID[ $item ].clone();
	}
	
	static debug( $msg ) {
		Logger.logServer( "ItemManager: " + $msg );
	}
}

module.exports = ItemManager;