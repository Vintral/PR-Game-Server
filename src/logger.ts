import chalk from 'chalk';
import dbase from './database';

class Logger {
    private settings:Record<string,boolean>;
    private database:any;
    
	constructor() {		
		this.settings = {
			admin: true,
			system: true,
			user: true,
			sent: true,
			received: true,
			connection: true,
			databse: true,
			server: true,
			error: true,
			bot: true,
			combat: true,
			notification: true
		}
	}
	
	getDatabase():any {
		return this.database;
	}
	
	logConnection( msg:string ):void {
		if( this.settings.connection )
		    console.log( chalk.green( "Connection: " + msg ) );
	}
	
	logDatabase( msg:string ):void {
		if( this.settings.database )
		    console.log( chalk.green( "Database: " + msg ) );
	}
	
	logAdmin( msg:string ):void {
		if( this.settings.admin )
		    console.log( chalk.gray.inverse( "Admin: " + msg ) );
	}

	logNotification( msg:string ):void {
		if( this.settings.notification )
		    console.log( chalk.yellow.inverse( "Notification: " + msg ) );
	}

	logBot( msg:string ):void {
		if( this.settings.bot )
		    console.log( chalk.green( msg ) );
	}
	
	logUser( msg:string ):void {
		if( this.settings.user )
		    console.log( chalk.cyan( "User: " + msg ) );
	}
	
	logSystem( msg:string ):void {
		if( this.settings.system )
		    console.log( chalk.magenta( "System: " + msg ) );
	}
	
	logSent( msg:string ):void {
		if( this.settings.sent )
		    console.log( chalk.yellow( "SENT: " + msg ) );
	}
	
	logServer( msg:string ):void {
		if( this.settings.server )
		    console.log( chalk.cyan( "SERVER: " + msg ) );
	}

	logCombat( msg:string ):void {
		if( this.settings.combat )
		    console.log( chalk.yellow( "COMBAT: " + msg ) );
	}
	
	logReceived( msg:string ):void {
		if( this.settings.received )
		    console.log( chalk.green( "RECEIVED: " + msg ) );
	}	
	
	logError( msg:string ):void {
		if( this.settings.error )
		    console.log( chalk.red.inverse( "ERROR:" ) + chalk.red( ' ' + msg ) );
	}
	 
	async refresh():Promise<boolean> {
		console.log( "Logger: refresh" );
		
		const settingsFromDatabase = await dbase.get( "SELECT * FROM settings" );
		if( settingsFromDatabase ) {
			for( var setting in settingsFromDatabase )
				this.settings[ settingsFromDatabase[ setting ].type ] = settingsFromDatabase[ setting ].value;			
        }
        
        return true;
	}
}

const logger = new Logger();
export default logger;