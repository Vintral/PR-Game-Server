var mysql = require( 'mysql2/promise' );
var Logger = require( './logger' );

var	EventEmitter = require( "events" ).EventEmitter;

class Database extends EventEmitter {
	constructor() {
		super();
		
		this._debug = true;
		this.database = mysql.createPool( {
			host : '104.236.71.139',
			connectionLimit: 125,
			queueLimit: 0,
			user : 'temp',			
			password : 't3mp',
			database : 'temp',
			debug : false
		} );
		
		this.database.on( 'acquire', this.onAcquired );
		this.database.on( 'connection', this.onConnection );
		this.database.on( 'enqueue', this.onEnqueued );
		this.database.on( 'release', this.onReleased );		
		this.database.on( 'test', this.onConnection );			
		
		this.debug( "Created" );
	}	
	
	dump() {
		console.log( "All: : " + this.database.pool._allConnections._list.length + "  Free: " + this.database.pool._freeConnections._list.length );
	}
	
	onAcquired() {
		Logger.logDatabase( "onAcquired" );
	}
	
	onConnection() {		
		Logger.logDatabase( "onConnection" );
	}
	
	onEnqueued() {
		Logger.logDatabase( "onEnqueued" );
	}
	
	onReleased() {
		Logger.logDatabase( "onReleased" );
	}
	
	async beginTransaction() {
		let connection = await this.database.getConnection();
		await connection.beginTransaction();
		return connection;
	}
	
	async getConnection( $callback ) {
		var self = this;
		
		Logger.logError( "SHOULD NOT BE CALLED" );
		
		const connection = await this.database.getConnection();
		return connection;		
		
		/*this.database.getConnection( function( err, connection ){
			if( err ) {
				Logger.logError( "Connecting to Database: " + err );			
				//response.json( { "code" : 100, "status" : "Error in connection database" } );
				return;
			} else {							
				if( $callback ) $callback( connection );
				else self.emit( "CONNECTION", connection );
								
				return connection;
			}
		} );*/
	}
	
	async commit( $connection ) {
		this.debug( "commit" );
		
		if( $connection ) {
			await $connection.commit();
			await $connection.release();
		}
	}
	
	async rollback( $connection ) {
		this.debug( "rollback" );
		
		if( $connection ) {
			$connection.rollback();
			$connection.release();
		}
	}
	
	async getOne( $query ) {		
		const data = await this.get( $query );
		return data[ 0 ];
	}
	
	async get( $query ) {
		this.debug( "Get: " + $query );
		const data = await this.database.query( $query );
		return data[ 0 ];
	}
	
	async execute( $query ) {
		this.debug( "Execute: " + $query );
		const result = await this.database.query( $query );
		return result[ 0 ];
	}
	
	async executeQuery( $query, $callback, $connection ) {
		console.log( "Acquiring: " + $query );		
		var self = this;
	
		if( !$connection ) {			
			/*this.database.query( $query, function( err, rows) {
				//console.log( "All: : " + self.database._allConnections.length + "  Free: " + self.database._freeConnections.length );
				if( err ) {
					console.log( "ERROR: " + err );					
				}
				if( $callback ) $callback( rows );
			} );*/
			
			const connection = await this.getConnection();
			if( connection ) {
				const result = await connection.query( $query );
				connection.release();
				
				console.log( results );
			}
			
			
			/*var connection = this.getConnection( function( connection ) {;
				if( connection ) {										
					connection.query( $query, function( err, rows ) {
						connection.release();
						//console.log( "Releasing: " + $query );
						//self.debug( "Released Connection" );
						if( $callback ) $callback( rows );
					} );
				} else Logger.logError( "Database: No Connection Retrieved!" );
			} );*/
		} else {					
			$connection.query( $query, function( err, rows ) {
				if( $callback ) $callback( rows );
			} )
		}

	}
	
	close() {
		this.debug( "close" );
		
		console.log( "KILL" );
		this.database.end( function( err ) {
			if( err ) console.log( "Error Killing Pool: " + err );
		} );
	}
	
	debug( $msg ) {
		if( this._debug )
			Logger.logDatabase( $msg );
	}
}

module.exports = new Database();