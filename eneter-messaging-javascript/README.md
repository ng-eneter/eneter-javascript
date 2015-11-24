# Eneter Messaging Framework 6.5 for JavaScript #

Eneter Messaging Framework is a lightweight cross-platform framework for the interprocess communication.<br/>
Using the framework you can connect applications across following platforms:
<ul>
	<li>Java 6 (or later)</li>
	<li>Android 2.1 (or later)</li>
	<li>Javascript</li>
	<li>.NET 3.5, 4.0, 4.5</li>
	<li>Windows Phone 7.0, 7.1, 8.0, 8.1</li>
	<li>Compact Framework 2.0, 3.5</li>
	<li>Silverlight 3, 4, 5</li>
	<li>Mono 2.6.4</li>
</ul>

## Eneter JavaScript Client ##
Eneter for Javascript provides client functionality allowing to implement the communication between HTML5 web-client
and a service implemented e.g. in .NET or Java.<br/>
Following communication scenarios are supported:

1. **Request-Response** communication.
JavaScript client can send request messages to the service and then receive one or more response messages.
> {@link DuplexTypedMessageSender}<br/>
> {@link WebSocketDuplexOutputChannel}<br/>
_Example:_ {@link http://eneter.blogspot.de/2014/05/html5-request-response-communication.html HTML5: Request-Response Communication Using WebSockets}

2. **Publish-Subscribe** communication.
JavaScript client can subscribe to desired events and then be notified in "real-time". It means when a desired
event occurs the message is immediately sent directly to the client (no polling and no long-polling techniques).
> {@link DuplexBrokerClient}<br/>
_Example:_ {@link http://eneter.blogspot.de/2014/05/html5-real-time-push-notifications-from.html HTML5: Real-Time Push Notifications from .NET Application}

Eneter for JavaScript communicates using the WebSocket protocol and serializes using the JSON serializer.
