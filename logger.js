var	colors = require('colors');

class Logger {	
	constructor() {		
		this.settings = {
			admin:1,
			system:1,
			user:1,
			sent:1,
			received:1,
			connection:1,
			databse:1,
			server:1,
			error:1,
			bot:1,
			combat:1,
			notification:1
		}
	}	
	
	setDatabase( $db ) {
		this.database = $db;
		this.refresh();		
	}
	
	getDatabase() {
		return this.database;
	}
	
	logConnection( $msg ) {
		if( !this.settings.connection ) return;
		console.log( ( "Connection: " + $msg ).green );
	}
	
	logDatabase( $msg ) {
		if( !this.settings.database ) return;
		console.log( ( "Database: " + $msg ).green );
	}
	
	logAdmin( $msg ) {
		if( !this.settings.admin ) return;
		console.log( ( "Admin: " + $msg ).gray.inverse );
	}

	logNotification( $msg ) {
		if( !this.settings.notification ) return;
		console.log( ( "Notification: " + $msg ).yellow.inverse );
	}

	logBot( $msg ) {
		if( !this.settings.bot ) return;		
		console.log( ( $msg ).green );
	}
	
	logUser( $msg ) {
		if( !this.settings.user ) return;
		console.log( ( "User: " + $msg ).cyan );
	}
	
	logSystem( $msg ) {
		if( !this.settings.system ) return;
		console.log( ( "System: " + $msg ).magenta );
	}
	
	logSent( $msg ) {
		if( !this.settings.sent ) return;
		console.log( ( "SENT: " + $msg ).yellow );
	}
	
	logServer( $msg ) {
		if( !this.settings.server ) return;
		console.log( ( "SERVER: " + $msg ).cyan );
	}

	logCombat( $msg ) {
		if( !this.settings.combat ) return;
		console.log( ( "COMBAT: " + $msg ).yellow );
	}
	
	logReceived( $msg ) {
		if( !this.settings.received ) return;
		console.log( ( "RECEIVED: " + $msg ).green );
	}	
	
	logError( $msg ) {
		if( !this.settings.error ) return;
		console.log( ( "ERROR: " + $msg ).red );
	}
	
	async refresh() {
		console.log( "Logger: refresh" );
		
		const settingsFromDatabase = await this.database.get( "SELECT * FROM settings" );
		if( settingsFromDatabase ) {
			for( var setting in settingsFromDatabase )
				this.settings[ settingsFromDatabase[ setting ].type ] = settingsFromDatabase[ setting ].value;			
		}
	}
}

module.exports = new Logger();