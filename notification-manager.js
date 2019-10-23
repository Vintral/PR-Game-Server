var Logger = require( './logger' );
const OneSignal = require( 'onesignal-node' );

const pushClient = new OneSignal.Client({      
	userAuthKey: 'NzkyNjYzNTgtZDg2NC00NzViLWFjNGQtMDY1NGY4MjBkZjI5',      
	// note that "app" must have "appAuthKey" and "appId" keys      
	app: { appAuthKey: 'NTJlOTBjMzQtYWQwMi00MTA1LWFhMDctOGFkYjBhNjNkYWY2', appId: 'a9083f8a-0a12-4f1c-970b-6a59adab0630' }      
 });

class NotificationManager {
    static get Database() { return this._database; }
    static set Database( value ) { this._database = value; }

	static async Send( $user, $type, $msg ) {
        NotificationManager.Debug( "Send: " + $user + " : " + $type + " : " + $msg );

        const typeQuery = "SELECT id FROM users_notifications_settings WHERE userid = " + $user + " AND type = '" + $type + "' LIMIT 1";
        const checkQuery = "SELECT id FROM users_notifications WHERE userid = " + $user + " AND time >= UNIX_TIMESTAMP() - 300 LIMIT 1";
        const tokenQuery = "SELECT token FROM users_push_tokens WHERE userid = " + $user;

        let result = await NotificationManager.Database.getOne( typeQuery );
        if( !result ) return;

        result = await NotificationManager.Database.getOne( checkQuery );
        if( result ) return;

        result = await NotificationManager.Database.get( tokenQuery );
        if( !result ) return;

        result.forEach( data => { 
            const notification = new OneSignal.Notification({      
                contents: {      
                    en: $msg
                },    
                include_player_ids: [ data.token ]
            });

            pushClient.sendNotification( notification, function ( err, httpResponse, data ) {
                if( err ) {      
                    console.log( 'Something went wrong...' );
                } else {      
                    console.log( data );
                }      
            } );
        } );
    }
	
	static Debug( $msg ) {
		Logger.logNotification( "NotificationManager: " + $msg );
	}
}

module.exports = NotificationManager;