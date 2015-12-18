/**
 * Copyright 2014 Ondrej Uzovic

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
 */

/**
 * Event arguments used for receiving messages from the broker.
 * @class
 */
function BrokerMessageReceivedEventArgs(messageTypeId, message, receivingError)
{
    /**
     * Returns type of the notified event.
     */
    this.MessageTypeId = messageTypeId;
    
    /**
     * Returns the notified message.
     */
    this.Message = message;
    
    /**
     * Returns the error detected during receiving of the message.
     */
    this.ReceivingError = receivingError;
}

/**
 * Broker client which can publish and subscribe messages in the broker.
 * @param {JsonSerializer} [serializer = null] serializer used to serialize/deserialize messages for/from DuplexBroker.
 * If null then {@link DuplexBrokerClient~BrokerCustomSerializer} is used by default. It is the high performance serializer specifically designed
 * just for the interaction with Broker. {@link DuplexBrokerClient~BrokerCustomSerializer} is not part of API.
 * @class
 * @augments AttachableDuplexOutputChannelBase
 * 
 * @example
 * // Create the duplex output channel.
 * var anOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8077/MyBroker/", null);
 * 
 * // Create BrokerClient
 * var aBrokerClient = new DuplexBrokerClient();
 * 
 * // Handler processing notification messages from the broker.
 * aBrokerClient.onBrokerMessageReceived = onBrokerMessageReceived;
 * 
 * // Attach output channel and be able to send messages and receive responses.
 * aBrokerClient.attachDuplexOutputChannel(anOutputChannel);
 * 
 * ...
 * 
 * // Subscribe to event from the broker.
 * aBrokerClient.subscribe("MyTimeEvent");
 * 
 * ...
 * 
 * // This is how you can unsubscribe.
 * aBrokerClient.unsubscribe("MyTimeEvent");
 * 
 * // Handler processing notifications from the broker.
 * function onBrokerMessageReceived(brokerMessageReceivedEventArgs) {
 * 
 *     if (brokerMessageReceivedEventArgs.MessageTypeId == "MyTimeEvent") {
 *         // Deserialize the event.
 *         var aValue = JSON.parse(brokerMessageReceivedEventArgs.Message);
 *         ...
 *     }
 *     else if (brokerMessageReceivedEventArgs.MessageTypeId == "SomeOtherEvent") {
 *     ...
 *     }
 * }
 * 
 * ...
 * 
 * // You also can send notification events to the broker.
 * // Broker will forward them to subscribers subscribed for that event.
 * 
 * // Declaring event class.
 * function MyEvent(value1, value2) {
 *     this.Value1 = value1;
 *     this.Value2 = value;
 * }
 * 
 * // Publishing event via the broker.
 * var anEvent = new MyEvent(123, 456);
 * var aSerializedEvent = JSON.stringify(anEvent);
 * aBrokerClient.sendMessage("MyEvent", aSerializedEvent);
 * 
 */
function DuplexBrokerClient(serializer)
{
    // Data message used for the communication with the broker.
    function BrokerMessage()
    {
        this.Request = null;
        this.MessageTypes = null;
        this.Message = null;
    };
    
    /**
     * Default broker serializer which is highly optimized to serialize/deserialize only BrokerMessage.
     * @inner
     */
    function BrokerCustomSerializer()
    {
        var myStringEncoding = new Utf8Encoding();
        
        this.serialize = function(brokerMessage)
        {
            var anInitializeSize = 100;
            var aDynamicDataView = new DynamicDataView(anInitializeSize);
            var aWriter = new EncoderDecoder(aDynamicDataView);
            
            // Encode request for the broker.
            aWriter.writeByte(brokerMessage.Request);
            
            // Encode message types.
            var aNumberOfMessageTypes = brokerMessage.MessageTypes.length;
            aWriter.writeInt32(aNumberOfMessageTypes, true);
            for (var i = 0; i < aNumberOfMessageTypes; ++i)
            {
                aWriter.writePlainString(brokerMessage.MessageTypes[i], myStringEncoding, true);
            }
            
            // If it is publish then encode the message.
            if (brokerMessage.Request === 40)
            {
                aWriter.write(brokerMessage.Message, true);
            }
            
            return aDynamicDataView.getArrayBuffer();
        };
        
        // Note: this broke client can receive only 'publish' message.
        //       So the deserialization is optimized for that.
        this.deserialize = function(dataToDeserialize)
        {
            var aDynamicDataView = new DynamicDataView(dataToDeserialize);
            var aReader = new EncoderDecoder(aDynamicDataView);
            
            // Skip 1st byte indicating type of the request - it can be only 'Publish'.
            aReader.skipBytes(1);
            
            // When receiving a notification message there is always only 1 message type.
            // So we can skip next 4 bytes indicating the number of message types.
            aReader.skipBytes(4);
            
            // Read the message type.
            var aMessageType = aReader.readPlainString(myStringEncoding, true);
            
            // Read the notified message.
            var aNotifiedMessage = aReader.read(true);
            
            var aBrokerMessage = new BrokerMessage();
            aBrokerMessage.MessageTypes = [aMessageType];
            aBrokerMessage.Message = aNotifiedMessage;
            
            return aBrokerMessage;
        };
    };
    
    // Ensure that inherited classes will not share the same instance of the parent class.
    AttachableDuplexOutputChannelBase.call(this);
    
    var mySerializer = (serializer) ? serializer : new BrokerCustomSerializer();
    
    // Store the context of this class.
    var mySelf = this;
    
    /**
     * The event is invoked when a message is received from the broker.
     * @param {BrokerMessageReceivedEventArgs} brokerMessageReceivedEventArgs
     */
    this.onBrokerMessageReceived = function(brokerMessageReceivedEventArgs) {};
    
    /**
     * Publishes the event via the broker.<br/>
     * It sends the message to the broker. When the broker receives the message it will then notify all subscribers
     * which are subscribed for the specified eventId.
     * @param {String} eventId identifies the type of the event.
     * @param {String} serializedMessage serialized event data which shall be published via Broker.
     */
    this.sendMessage = function(eventId, serializedMessage)
    {
        var aBrokerMessage = new BrokerMessage();
        aBrokerMessage.Request = 40; // enum value for Publish
        aBrokerMessage.MessageTypes = [eventId];
        aBrokerMessage.Message = serializedMessage;
        
        send(this.getAttachedDuplexOutputChannel(), aBrokerMessage);
    };
    
    /**
     * Subscribes the client for the event or list of events.
     * @param {(String|String[])} eventId identifies event or list of events to be subscribed in the broker.
     */
    this.subscribe = function(eventId)
    {
        var aMessageTypes = null;
        if (eventId instanceof Array)
        {
            aMessageTypes = eventId;
        }
        else
        {
            aMessageTypes = [eventId];
        }
        
        var aBrokerMessage = new BrokerMessage();
        aBrokerMessage.Request = 10; // enum value for Subscribe
        aBrokerMessage.MessageTypes = aMessageTypes;
        
        send(this.getAttachedDuplexOutputChannel(), aBrokerMessage);
    };
    
    /**
     * Unsubscribes the client from the specified event or list of events.
     * @param {(string|string[])} eventId identifies event or list of events to be unsubscribed from the broker.
     */
    this.unsubscribe = function(eventId)
    {
        var aMessageTypes = null;
        if (eventId instanceof Array)
        {
            aMessageTypes = eventId;
        }
        else
        {
            aMessageTypes = [eventId];
        }
        
        var aBrokerMessage = new BrokerMessage();
        aBrokerMessage.Request = 20; // enum value for Unsubscribe
        aBrokerMessage.MessageTypes = aMessageTypes;
        
        send(this.getAttachedDuplexOutputChannel(), aBrokerMessage);
    };
    
    var send = function(outputChannel, brokerMessage)
    {
        if (outputChannel === null)
        {
            throw new Error("Failed to send the message because the output channel is not attached.");
        }
        
        try
        {
            var aSerializedMessage = mySerializer.serialize(brokerMessage);
            outputChannel.sendMessage(aSerializedMessage);
        }
        catch (err)
        {
            logError("Failed to send the message.", err);
            throw err;
        }
    };
    
    // Override the message handler from the base class.
    this._onResponseMessageReceived = function(duplexChannelMessageEventArgs)
    {
        var aMessageType = null;
        var aMessageContent = null;
        var anError = null;
        
        try
        {
            // Deserialize incoming message.
            var aBrokerMessage = mySerializer.deserialize(duplexChannelMessageEventArgs.Message);
            aMessageType = aBrokerMessage.MessageTypes[0];
            aMessageContent = aBrokerMessage.Message;
        }
        catch (err)
        {
            anError = err;
            logError("Failed to deserialize message from Broker.", err);
        }

        try
        {
            // Raise the event.
            var aBrokerMessageReceivedEventArgs = new BrokerMessageReceivedEventArgs(aMessageType, aMessageContent, anError);
            mySelf.onBrokerMessageReceived(aBrokerMessageReceivedEventArgs);
        }
        catch (err)
        {
            logError("Detected a failure in the event handler.", err);
        }
    };
};
DuplexBrokerClient.prototype = new AttachableDuplexOutputChannelBase();
DuplexBrokerClient.constructor = DuplexBrokerClient;

/**
 * Sends and receives messages of multiple types.<br/>
 * Messages are serialized/deserialized using Json.
 * 
 * @class
 *
 * @example
 * // Declare response message.
 * function MyResponseMessage1 {
 *    this.Number;
 * };
 * 
 * // Declare some other type of response message.
 * function MyResponseMessage2 {
 *    this.Name;
 *    this.Count;
 * };
 * 
 * // Create the duplex output channel.
 * var anOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8890/MyService/", null);
 * 
 * // Create MultiTypedMessageSender.
 * var aSender = new MultiTypedMessageSender();
 * 
 * // Register handlers to receive messages.
 * aSender.registerResponseMessageReceiver(onResponseMessage1, "MyResponseMessage1");
 * aSender.registerResponseMessageReceiver(onResponseMessage2, "MyResponseMessage2");
 * 
 * // Attach output channel and be able to send messages and receive responses.
 * aSender.attachDuplexOutputChannel(anOutputChannel);
 * 
 * ...
 * 
 * // Message which shall be sent. 
 * function RequestMessage(name) {
 *     this.Name = name;
 * };
 * 
 * // Send a message.
 * var aMessage = new RequestMessage("Hello World.");
 * aSender.sendRequestMessage(aMessage, aMessage.constructor.name);
 * 
 * ...
 * 
 * // Detach output channel and stop listening to responses.
 * aSender.detachDuplexOutputChannel();
 * 
 * ...
 * 
 * // Handler processing response message 1
 * function onResponseMessage1(typedResponseReceivedEventArgs) {
 * 
 *     // Note: aMessage is already deserialized message.
 *     var aMessage = typedResponseReceivedEventArgs.ResponseMessage;
 *     ...
 * };
 * 
 * // Handler processing response message 2
 * function onResponseMessage1(typedResponseReceivedEventArgs) {
 * 
 *     // Note: aMessage is already deserialized message.
 *     var aMessage = typedResponseReceivedEventArgs.ResponseMessage;
 *     ...
 * };
 * 
 */
function MultiTypedMessageSender()
{
    // MultiTypedMessage declaration.
    function MultiTypedMessage()
    {
        this.TypeName = null;
        this.MessageData = null;
    };
    
    var mySerializer = new JsonSerializer();
    var mySender = new DuplexTypedMessageSender();
    var myMessageHandlers = new EneterHashMap();
    
    mySender.onConnectionOpened = onConnectionOpened;
    mySender.onConnectionClosed = onConnectionClosed;
    mySender.onResponseReceived = onResponseMessageReceived;
    
    
    /**
     * The event which can be subscribed to receive the notification when the connection is open.
     * @example
     * // Set your handler to receive open connection notification. 
     * aSender.onConnectionOpened = yourOnConnectionOpened;
     */
    this.onConnectionOpened = function(duplexChannelEventArgs) {};

    /**
     * The event which can be subscribed to receive the notification when the connection was closed.
     * @example
     * // Set your handler to receive close connection notification.
     * aSender.onConnectionClosed = yourOnConnectionClosed;
     */
    this.onConnectionClosed = function(duplexChannelEventArgs) {};
    
    /**
     * Attaches the duplex output channel and opens the connection for sending request messages
     * and receiving response messages.
     * @param {WebSocketDuplexOutputChannel} outputChannel
     * @throws Throws an error if attaching fails.
     */
    this.attachDuplexOutputChannel = function(outputChannel)
    {
        mySender.attachDuplexOutputChannel(outputChannel);
    };

    /**
     * Detaches the duplex output channel and stops listening to response messages.
     */
    this.detachDuplexOutputChannel = function()
    {
        mySender.detachDuplexOutputChannel();
    };

    /**
     * Returns true if the reference to the duplex output channel is stored.
     */
    this.isDuplexOutputChannelAttached = function()
    {
        return mySender.isDuplexOutputChannelAttached();
    };

    /**
     * Returns attached duplex output channel.
     */
    this.getAttachedDuplexOutputChannel = function()
    {
        return mySender.getAttachedDuplexOutputChannel();
    };
    
    /**
     * Registers response message handler for specified message type.
     * @param {TypedResponseReceivedEventArgs} handler function expecting TypedResponseReceivedEventArgs as input parameter.
     * @param {String} clazz name of the message type.
     * @throws Throws an error if a handler for the specified message type is already registered.
     */
    this.registerResponseMessageReceiver = function(handler, clazz)
    {
        if (!handler)
        {
            var anError = "Failed to register handler for message " + clazz + " because the input parameter handler is null.";
            logError(anError);
            throw new Error(anError);
        }
		if (!clazz)
        {
            var anError = "Failed to register handler because the input parameter clazz is null.";
            logError(anError);
            throw new Error(anError);
        }
        
        var aMessageHandler = myMessageHandlers.get(clazz);
        if (aMessageHandler !== null)
        {
            var anError = "Failed to register handler for message " + clazz + " because the handler for such class name is already registered.";
            logError(anError);
            throw new Error(anError);
        }
        
        myMessageHandlers.put(clazz, handler);
    }
    
    /**
     * Unregisters the message handler.
     * @param {String} clazz message type for which the handler shall be unregistered.
     */
    this.unregisterResponseMessageReceiver = function(clazz)
    {
        myMessageHandlers.remove(clazz);
    }
    
    /**
     * Returns array of types which have registered handlers.
     * @returns {String[]} type names which are registered for receiving.
     */
    this.getRegisteredResponseMessageTypes = function()
    {
        return myMessageHandlers.keys();
    }
    
    /**
     * Sends a message.
     * @param message object which shall be sent.
     * @param {String} clazz message object type name.
     */
    this.sendRequestMessage = function(message, clazz)
    {
        try
        {
            var aMessage = new MultiTypedMessage();
            aMessage.TypeName = clazz;
            aMessage.MessageData = mySerializer.serialize(message);
    
            mySender.sendRequestMessage(aMessage);
        }
        catch (err)
        {
            logError("Failed to send the message.", err);
            throw err;
        }
    }
    
    function onResponseMessageReceived(typedResponseReceivedEventArgs)
    {
        if (typedResponseReceivedEventArgs.ResponseMessage === null)
        {
            return;
        }
        
        var aMultiTypedMessage = typedResponseReceivedEventArgs.ResponseMessage;
        var aDeserializedMessageData = null;
        var anError = null;
        
        try
        {
            // Deserialize incoming message.
            aDeserializedMessageData = mySerializer.deserialize(aMultiTypedMessage.MessageData);
        }
        catch (err)
        {
            anError = err;
            logError("Failed to deserialize the response message.", err);
        }

        // Call handler.
        var aHandler = myMessageHandlers.get(aMultiTypedMessage.TypeName);
        if (aHandler !== null)
        {
            try
            {
                var aResponseReceivedEventArgs = new TypedResponseReceivedEventArgs(aDeserializedMessageData, anError);
                aHandler(aResponseReceivedEventArgs);
            }
            catch (err)
            {
                logError("Detected a failure in the message handler.", err);
            }
        }
    }
};



/**
 * Event arguments for receiving a response message from DuplexTypedMessageSender.
 * @class
 */
function TypedResponseReceivedEventArgs(responseMessage, receivingError)
{
    /**
     * Returns deserialized message object.
     */
    this.ResponseMessage = responseMessage;

    /**
     * Returns an exception detected during receiving the response message.
     */
    this.ReceivingError = receivingError;
};

/**
 * Sends request messages and receives response messages of a specific type.<br/>
 * It uses JsonSerializer to serialize/deserialize messages.
 * 
 * @class
 * @augments AttachableDuplexOutputChannelBase
 * 
 * @example
 * // Create the duplex output channel.
 * var anOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8890/MyService/", null);
 * 
 * // Create DuplexTypedMessageSender.
 * var aSender = new DuplexTypedMessageSender();
 * 
 * // Subscribe to receive response messages.
 * aSender.onResponseReceived = onResponseReceived;
 * 
 * // Attach output channel and be able to send messages and receive responses.
 * aSender.attachDuplexOutputChannel(anOutputChannel);
 * 
 * ...
 * 
 * // Message which shall be sent. 
 * function MessageData(name, number) {
 *     this.Name = name;
 *     this.Number = number;
 * };
 * 
 * // Send a message.
 * var aMessage = new MessageData("Hello World.", 123);
 * aSender.sendRequestMessage(aMessage);
 * 
 * ...
 * 
 * // Detach output channel and stop listening to responses.
 * aSender.detachDuplexOutputChannel();
 * 
 * ...
 * 
 * // Event handler processing received response messages.
 * function onResponseReceived(typedResponseReceivedEventArgs) {
 * 
 *     // Note: aMessage is already deserialized message.
 *     var aMessage = typedResponseReceivedEventArgs.ResponseMessage;
 *     ...
 * }
 * 
 */
function DuplexTypedMessageSender()
{
    // Ensure that inherited classes will not share the same instance of the parent class.
    AttachableDuplexOutputChannelBase.call(this);
    
    var mySerializer = new JsonSerializer();
    
    // Store the context of this class.
    var mySelf = this;
    
    /**
     * The event which can be subscribed to receive response messages.
     * @param {TypedResponseReceivedEventArgs} responseMessage received response message.
     * @example
     * // Create DuplexTypedMessageSender.
     * var aSender = new DuplexTypedMessageSender();
     * 
     * // Subscribe to receive response messages.
     * aSender.onResponseReceived = onResponseReceived;
     * 
     * ...
     * 
     * // Event handler processing received response messages.
     * function onResponseReceived(typedResponseReceivedEventArgs) {
     * 
     *     // Note: aMessage is already deserialized message.
     *     var aMessage = typedResponseReceivedEventArgs.ResponseMessage;
     *     ...
     * }
     */
    this.onResponseReceived = function(responseMessage) {};
    
    /**
     * Serializes the given message and sends it.
     * @param message object that shall be serialized and sent.
     * @throws Throws error if sending fails.
     */
    this.sendRequestMessage = function(message)
    {
        if (this.isDuplexOutputChannelAttached() === false)
        {
            throw new Error("Failed to send the message because the output channel is not attached.");
        }

        try
        {
            var aSerializedMessage = mySerializer.serialize(message);
            this.getAttachedDuplexOutputChannel().sendMessage(aSerializedMessage);
        }
        catch (err)
        {
            logError("Failed to send the message.", err);
            throw err;
        }
    };
    
    // Overrides the message handler from the base class.
    // It deserializes the received message and invokes event notifying the response message was received.
    this._onResponseMessageReceived = function(duplexChannelMessageEventArgs)
    {
        var anObject = null;
        var anError = null;
        
        try
        {
            // Deserialize incoming message.
            anObject = mySerializer.deserialize(duplexChannelMessageEventArgs.Message);
        }
        catch (err)
        {
            anError = err;
            logError("Failed to deserialize the response message.", err);
        }

        // Raise the event.
        var aResponseReceivedEventArgs = new TypedResponseReceivedEventArgs(anObject, anError);
        mySelf.onResponseReceived(aResponseReceivedEventArgs);
    };
};
DuplexTypedMessageSender.prototype = new AttachableDuplexOutputChannelBase();
DuplexTypedMessageSender.constructor = DuplexTypedMessageSender;

/**
 * JSON serializer for Eneter.<br/>
 * This serializer is used by {@link DuplexTypedMessageSender} and {@link MultiTypedMessageSender} by default.
 * @class
 */
function JsonSerializer()
{
    /**
     * Serializes data.
     * @param dataToSerialize data to serialize.
     * @returns data serialized into String. 
     */
    this.serialize = function(dataToSerialize)
    {
        var aSerializedData = JSON.stringify(dataToSerialize);
        return aSerializedData;
    };
    
    /**
     * Deserializes data.
     * @param {String} dataToDeserialize data to deserialize.
     * @returns instance of deserialized data.
     */
    this.deserialize = function(dataToDeserialize)
    {
        var aDeserializedObject = JSON.parse(dataToDeserialize);
        return aDeserializedObject;
    };
};

/**
 * Base class for communication components which need a capability to attach duplex output channel.
 * This is meant to be abstract class. Therefore do not instantiate it directly.
 * @class
 * @abstract
 */
function AttachableDuplexOutputChannelBase()
{
    // Private data members.
    var myOutputChannel = null;

    /**
     * The event which can be subscribed to receive the notification when the connection is open.
     * @example
     * // Set your handler to receive open connection notification. 
     * aSender.onConnectionOpened = yourOnConnectionOpened;
     */
    this.onConnectionOpened = function(duplexChannelEventArgs) {};

    /**
     * The event which can be subscribed to receive the notification when the connection was closed.
     * @example
     * // Set your handler to receive close connection notification.
     * aSender.onConnectionClosed = yourOnConnectionClosed;
     */
    this.onConnectionClosed = function(duplexChannelEventArgs) {};

    /**
     * The event is invoked when the response message is received.
     * This event handler method is supposed to be overridden by derived classes.
     */
    this._onResponseMessageReceived = function(duplexChannelMessageEventArgs) {};

    /**
     * Attaches the duplex output channel and opens the connection for sending request messages
     * and receiving response messages.<br/>
	 * Please notice when the call returns from this method the connection does not have to be open yet.
	 * It can be still in the state opening. Use onConnectionOpened eent to detect when the connetion is open.
     * @param {WebSocketDuplexOutputChannel} outputChannel
     * @throws Throws an error if attaching fails.
     */
    this.attachDuplexOutputChannel = function(outputChannel)
    {
        try
        {
            if (outputChannel === null)
            {
                throw new Error("Failed to attach output channel because the output channel is null.");
            }
            if (isNullOrEmpty(outputChannel.getChannelId()))
            {
                throw new Error("Failed to attach output channel because the channel id is null or empty string.");
            }
            if (this.isDuplexOutputChannelAttached())
            {
                throw new Error("Failed to attach output channel because the output channel is already attached.");
            }

            myOutputChannel = outputChannel;

            // Subscribe to events.
            myOutputChannel.onConnectionOpened = this.onConnectionOpened;
            myOutputChannel.onConnectionClosed = this.onConnectionClosed;
            myOutputChannel.onResponseMessageReceived = this._onResponseMessageReceived;

            myOutputChannel.openConnection();
        }
        catch (err)
        {
            this.detachDuplexOutputChannel();
            throw err;
        }
    };

    /**
     * Detaches the duplex output channel and stops listening to response messages.
     */
    this.detachDuplexOutputChannel = function()
    {
        if (myOutputChannel !== null)
        {
            try
            {
                myOutputChannel.closeConnection();
            }
            catch (err)
            {
            }

            // Unsubscribe from events.
            myOutputChannel.onConnectionOpened = function(duplexChannelEventArgs) {};
            myOutputChannel.onConnectionClosed = function(duplexChannelEventArgs) {};
            myOutputChannel.onResponseMessageReceived = function(duplexChannelMessageEventArgs) {};

            myOutputChannel = null;
        }
    };

    /**
     * Returns true if the duplex output channel is attached.<br/>
	 * Please notice when the channel is attached it does not have to be connected.
	 * E.g. once the output channel was attached and the connection was open and then the connection was broken or closed by input channel.
     */
    this.isDuplexOutputChannelAttached = function()
    {
        return myOutputChannel !== null;
    };

    /**
     * Returns attached duplex output channel.
     */
    this.getAttachedDuplexOutputChannel = function()
    {
        return myOutputChannel;
    };
};

/**
 * Output channel which provides the authentication mechanism.<br/>
 * <br/>
 * Here is how the authentication procedure works:
 * <ol>
 * <li>AuthenticatedDuplexOutputChannel calls getLoginMessage callback and gets the login message. Then
 *     sends it to AuthenticatedDuplexInputChannel.</li>
 * <li>AuthenticatedDuplexInputChannel receives the login message and calls getHandshakeMessage callback.
 *     The returned handshake message is sent to AuthenticatedDuplexOutputChannel.</li>
 * <li>AuthenticatedDuplexOutputChannel receives the handshake message and calls getHandshakeResponseMessage.
 *     The returned handshake response message is then sent to AuthenticatedDuplexInputChannel.</li>
 * <li>AuthenticatedDuplexInputChannel receives the handshake response message and calls authenticate callback.
 *     if it returns true the connection is established.</li>
 * </ol>
 * 
 * @class
 * @param {WebSocketDuplexOutputChannel | MessageBusOutputChannel} underlyingDuplexOutputChannel underlying output channel which shall be used for the communication.
 * @param {AuthenticatedDuplexOutputChannel~getLoginMessageCallback} getLoginMessageCallback callback method returning login message.
 * @param {AuthenticatedDuplexOutputChannel~getHandshakeResponseMessageCallback} getHandshakeResponseMessageCallback callback method returning response message for the handshake message.
 * 
 * @example
 * // Create websocket output channel.
 * var anUnderlyingOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8033/Service/", null);
 * 
 * // Create authenticated output channel based on websocket output channel.
 * var anOutputChannel = new AuthenticatedDuplexOutputChannel(anUnderlyingOutputChannel, onGetLogin, onGetHandshakeResponse);
 * 
 * // Create MultiTypedMessageSender.
 * var aSender = new MultiTypedMessageSender();
 *
 * // Register message handler
 * aSender.registerResponseMessageReceiver(onMyMessageTypeResponseReceived, "MyMessageType");
 * 
 *
 * ...
 * // Callback method called from AuthenticatedDuplexOutputChannel to get the login.
 * function onGetLogin(channelId, responseReceiverId) {
 *     var aLogin = document.getElementById("login").value;
 *     return aLogin;
 * }
 * 
 * // Callback method called from AuthenticatedDuplexOutputChannel to get the password.
 * function onGetHandshakeResponse(channelId, responseReceiverId, handshakeMessage) {
 *     var aPassword = document.getElementById("password").value;
 *     return aPassword;
 * }
 *
 *
 * // Method called when login is pressed.
 * function onLogin() {
 *     // Attach output channel and be able to send messages and receive responses.
 *     // Note: the attached authenticated output channel ensures the authentication sequence is performed.
 *     aSender.attachDuplexOutputChannel(anOutputChannel);
 * };
 *
 * // Method called when logout is pressed.
 * function onLogout() {
 *     // Detach output channel and stop listening to responses.
 *     aSender.detachDuplexOutputChannel();
 * };
 */
function AuthenticatedDuplexOutputChannel(underlyingDuplexOutputChannel, getLoginMessageCallback, getHandshakeResponseMessageCallback)
{
    /**
     * Callback method which is used by {@link AuthenticatedDuplexOutputChannel} to get the login message.
     * @callback AuthenticatedDuplexOutputChannel~getLoginMessageCallback
     * @param {String} channelId address which shall be connected.
     * @param {String} responseReceiverId unique id representing the connection.
     * @return {String | ArrayBuffer} login message
     */
    function getLoginMessage(channelId, responseReceiverId){};
    
    /**
     * Callback method which is used by {@link AuthenticatedDuplexOutputChannel} to get the response for the handshake message.
     * @callback AuthenticatedDuplexOutputChannel~getHandshakeResponseMessageCallback
     * @param {String} channelId address which shall be connected.
     * @param {String} responseReceiverId unique id representing the connection.
     * @param {String | ArrayBuffer} handshakeMessage handshake message received from the service.
     * @return {String | ArrayBuffer} response for the handshake message.
     */
    function getHandshakeResponseMessage(channelId, responseReceiverId, handshakeMessage){};
    
    if (!underlyingDuplexOutputChannel)
    {
        throw new Error("Failed to create AuthenticatedDuplexOutputChannel because input parameter underlyingDuplexOutputChannel is null.");
    }
    if (!getLoginMessageCallback)
    {
        throw new Error("Failed to create AuthenticatedDuplexOutputChannel because input parameter getLoginMessageCallback is null.");
    }
    if (!getHandshakeResponseMessageCallback)
    {
        throw new Error("Failed to create AuthenticatedDuplexOutputChannel because input parameter getHandshakeResponseMessageCallback is null.");
    }
    
    var myUnderlyingOutputChannel = underlyingDuplexOutputChannel;
    myUnderlyingOutputChannel.onResponseMessageReceived = _onResponseMessageReceived;
    myUnderlyingOutputChannel.onConnectionOpened = _onConnectionOpened;
    myUnderlyingOutputChannel.onConnectionClosed = _onConnectionClosed;
    
    var myGetLoginMessageCallback = getLoginMessageCallback;
    var myGetHandshakeResponseMessageCallback = getHandshakeResponseMessageCallback;
    
    var myIsHandshakeResponseSent = false;
    var myIsConnectionAcknowledged = false;
    var myTracedObject = "AuthenticatedDuplexOutputChannel ";
    
    // Store the context of this class.
    var mySelf = this;
    
    
	/**
     * The event is invoked when a response message was received.
     * @param {DuplexChannelMessageEventArgs} duplexChannelMessageEventArgs
     */
    this.onResponseMessageReceived = function(duplexChannelMessageEventArgs) {};
    
	/**
     * The event is invoked when the connection with the duplex input channel was opened.
     * @param {DuplexChannelEventArgs} duplexChannelEventArgs
	 * @example
	 * // Set your handler to receive open connection notification. 
     * aSender.onConnectionOpened = yourOnConnectionOpened;
     */
    this.onConnectionOpened = function(duplexChannelEventArgs) {};

	/**
     * The event is invoked when the connection with the duplex input channel was closed.
     * @param {DuplexChannelEventArgs} duplexChannelEventArgs
	 * @example
	 * // Set your handler to receive close connection notification.
     * aSender.onConnectionClosed = yourOnConnectionClosed;
     */
    this.onConnectionClosed = function(duplexChannelEventArgs) {};
    
	/**
     * Returns the channel id. It represents the service address.
     * @returns {String}
     */
    this.getChannelId = function()
    {
        return myUnderlyingOutputChannel.getChannelId();
    };

	/**
     * Returns the response receiver id. It uniquely represents this client at the service.
     * @returns {String}
     */
    this.getResponseReceiverId = function()
    {
        return myUnderlyingOutputChannel.getResponseReceiverId();
    };
    
	/**
     * Opens connection with the duplex input channel.<br/>
	 * When opening it performes the authentication sequence.
     * @throws Throws error if connection could not be open.
     */
    this.openConnection = function()
    {
        if (this.isConnected())
        {
            throw new Error("Connection is already open.");
        }

        try
        {
            myIsHandshakeResponseSent = false;
            myIsConnectionAcknowledged = false;

            // Once the connection is open the code continues in _onConnectionOpened().
            myUnderlyingOutputChannel.openConnection();
        }
        catch (err)
        {
            logError(myTracedObject + "failed to open connection.", err);
            closeConnection();
            throw err;
        }
    };
    
	/**
     * Closes connection with the duplex input channel.
     */
    this.closeConnection = function()
    {
        myUnderlyingOutputChannel.closeConnection();
    };
    
	/**
     * Returns true if the connection with the duplex input channel is open.
     * @returns {Boolean}
     */
    this.isConnected = function()
    {
        return myUnderlyingOutputChannel.isConnected();
    };
    
	/**
     * Sends the message to the duplex input channel.
     * @param {String | ArrayBuffer} message message to be sent
     * @throws Throws error if sending fails.
     */
    this.sendMessage = function(message)
    {
        if (!this.isConnected())
        {
            var aMessage = myTracedObject + "failed to send the message because the output channel is not connected.";
            logError(aMessage);
            throw new Error(aMessage);
        }

        myUnderlyingOutputChannel.sendMessage(message);
    };
    
    function _onConnectionOpened(duplexChannelEventArgs)
    {
        var aCloseConnectionFlag = false;
        var aLoginMessage;
        try
        {
            aLoginMessage = myGetLoginMessageCallback(this.getChannelId(), this.getResponseReceiverId());
        }
        catch (err)
        {
            logError(myTracedObject + "failed to get the login message.", err);
            aCloseConnectionFlag = true;
        }
        
        try
        {
            myUnderlyingOutputChannel.sendMessage(aLoginMessage);
        }
        catch (err)
        {
            logError(myTracedObject + "failed to send the login message.", err);
            aCloseConnectionFlag = true;
        }
        
        if (aCloseConnectionFlag)
        {
            myUnderlyingOutputChannel.closeConnection();
        }
    }
    
    function _onConnectionClosed(duplexChannelEventArgs)
    {
        try
        {
            mySelf.onConnectionClosed(duplexChannelEventArgs);
        }
        catch (err)
        {
            logError("Detected a failure in the event handler.", err);
        }
    }
    
    function _onResponseMessageReceived(duplexChannelMessageEventArgs)
    {
        if (myIsConnectionAcknowledged)
        {
            try
            {
                mySelf.onResponseMessageReceived(duplexChannelMessageEventArgs);
            }
            catch (err)
            {
                logError("Detected a failure in the event handler.", err);
            }
            
            return;
        }
        
        var aCloseConnectionFlag = false;
        
        // This is the handshake message.
        if (!myIsHandshakeResponseSent)
        {
            //HANDSHAKE RECEIVED
            
            var aHandshakeResponseMessage;
            try
            {
                aHandshakeResponseMessage = myGetHandshakeResponseMessageCallback(
                        duplexChannelMessageEventArgs.ChannelId,
                        duplexChannelMessageEventArgs.ResponseReceiverId,
                        duplexChannelMessageEventArgs.Message);
                
                aCloseConnectionFlag = (aHandshakeResponseMessage === null);
            }
            catch (err)
            {
                logError(myTracedObject + "failed to get the handshake response message. The connection will be closed.", err)
                aCloseConnectionFlag = true;
            }
            
            // Send back the response for the handshake.
            if (!aCloseConnectionFlag)
            {
                try
                {
                    // Note: keep setting this flag before sending. Otherwise synchronous messaging will not work!
                    myIsHandshakeResponseSent = true;
                    myUnderlyingOutputChannel.sendMessage(aHandshakeResponseMessage);
                }
                catch (err)
                {
                    myIsHandshakeResponseSent = false;
                    logError(myTracedObject + "failed to send the handshake response message. The connection will be closed.", err);
                    aCloseConnectionFlag = true;
                }
            }
        }
        else
        {
            // CONNECTION ACKNOWLEDGE RECEIVED
            
            var anAcknowledgeMessage = duplexChannelMessageEventArgs.Message;
            if (anAcknowledgeMessage !== "OK")
            {
                logError(myTracedObject + "detected incorrect acknowledge message. The connection will be closed.");
                aCloseConnectionFlag = true;
            }
            else
            {
                myIsConnectionAcknowledged = true;
                
                try
                {
                    var anEventArgs = new DuplexChannelEventArgs(mySelf.getChannelId(), mySelf.getResponseReceiverId());
                    mySelf.onConnectionOpened(anEventArgs);
                }
                catch (err)
                {
                    logError("Detected a failure in the event handler.", err);
                }
            }
        }
        
        if (aCloseConnectionFlag)
        {
            myUnderlyingOutputChannel.closeConnection();
        }
    }
};

/**
 * Output channel which provides the connection via the message bus.<br/>
 * It uses the underlying messageBusOutputChannel to open connection to the message bus and then it asks the message bus to open
 * the connection with a specified service.
 * @class
 * @param {String} serviceId id which specifies the address of the service within the message bus.
 * @param {String} [responseReceiverId = null] uniquely represents the connection with the service behind the message bus.
 *   The id is not sent to the service but is itendend for the client to recognize the connection.
 *   If null then responsereceiverId is generated automatically.
 * @param {WebSocketDuplexOutputChannel | AuthenticatedDuplexOutputChannel} messageBusOutputChannel underlaying output channel which
 *   connects the message bus.
 * @param {serializer} [serializer = null] serializer responsible to serialize/deserialize the communication with the message bus.
 *   If null then the default MessageBusCustomSerializer is used.
 *
 * @example
 * // Create websocket output channel for the communication with the message bus.
 * // ws://127.0.0.1:8045/Clients/ is the address where the message listens to requests from clients.
 * var anUnderlyingMessageBusOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8045/Clients/", null);
 * 
 * // Create message bus output channel which will ensure communication with the specified service behind the message bus.
 * // The service which is requested from the message bus is called CalculatorService.
 * var aMessageBusOutputChannel = new MessageBusOutputChannel("CalculatorService", null, anUnderlyingMessageBusOutputChannel);
 * 
 * // Create MultiTypedMessageSender.
 * var aSender = new MultiTypedMessageSender();
 * 
 * // Register message handler
 * aSender.registerResponseMessageReceiver(onMyMessageTypeResponseReceived, "MyMessageType");
 * 
 * // When 'Open Connection' button is pressed.
 * function onOpenConnection() {
 *     // Attach output channel and be able to send messages and receive responses to/from the service behind the message bus.
 *     aSender.attachDuplexOutputChannel(aMessageBusOutputChannel);
 * }
 *
 * // When 'Close Connection' button is pressed.
 * function onCloseConnection() {
 *     // Detach output channel and stop listening to responses.
 *     aSender.detachDuplexOutputChannel();
 * }
*/
function MessageBusOutputChannel(serviceId, responseReceiverId, messageBusOutputChannel, serializer)
{
    // Message data structure used for the communication with MessageBus.
    function MessageBusMessage()
    {
        this.Request = null;
        this.Id = null;
        this.MessageData = null;
    };
    
    // Custom serializer which can serialize/deserialize only MessageBusMessage.
    function MessageBusCustomSerializer()
    {
        var myStringEncoding = new Utf8Encoding();
        
        this.serialize = function(messageBusMessage)
        {
            var anInitializeSize = 100;
            var aDynamicDataView = new DynamicDataView(anInitializeSize);
            var aWriter = new EncoderDecoder(aDynamicDataView);
            
            // Write messagebus request.
            aWriter.writeByte(messageBusMessage.Request);
            
            // Write Id.
            aWriter.writePlainString(messageBusMessage.Id, myStringEncoding, true);
            
            // Write message data.
            if (messageBusMessage.Request === 50 || messageBusMessage.Request === 60)
            {
                if (messageBusMessage.MessageData === null)
                {
                    throw new Error("Message data is null.");
                }
                
                aWriter.write(messageBusMessage.MessageData, true);
            }
            
            return aDynamicDataView.getArrayBuffer();
        };
        
        this.deserialize = function(dataToDeserialize)
        {
            var aDynamicDataView = new DynamicDataView(dataToDeserialize);
            var aReader = new EncoderDecoder(aDynamicDataView);
            
            var aMessageBusMessage = new MessageBusMessage();
            aMessageBusMessage.Request = aReader.readByte();
            aMessageBusMessage.Id = aReader.readPlainString(myStringEncoding, true);
            
            if (aMessageBusMessage.Request === 50 || aMessageBusMessage.Request === 60)
            {
                aMessageBusMessage.MessageData = aReader.read(true);
            }
            
            return aMessageBusMessage;
        };
    }
    
    if (!messageBusOutputChannel)
    {
        throw new Error("Failed to create AuthenticatedDuplexOutputChannel because input parameter underlyingDuplexOutputChannel is null.");
    }
    
    var mySerializer = (serializer) ? serializer : new MessageBusCustomSerializer();
    var myChannelId = serviceId;
    var myResponseReceiverId = (responseReceiverId) ? responseReceiverId : serviceId + "_" + getGuid();
    
    var myMessageBusOutputChannel = messageBusOutputChannel;
    myMessageBusOutputChannel.onResponseMessageReceived = _onResponseMessageReceived;
    myMessageBusOutputChannel.onConnectionOpened = _onConnectionOpened;
    myMessageBusOutputChannel.onConnectionClosed = _onConnectionClosed;
    
    var myTracedObject = "MessageBusOutputChannel ";
    
    // Store the context of this class.
    var mySelf = this;
    
    /**
     * The event is invoked when a response message was received.
     * @param {DuplexChannelMessageEventArgs} duplexChannelMessageEventArgs
     */
    this.onResponseMessageReceived = function(duplexChannelMessageEventArgs) {};
    
	/**
     * The event is invoked when the connection with the duplex input channel was opened.
     * @param {DuplexChannelEventArgs} duplexChannelEventArgs
	 * @example
	 * // Set your handler to receive open connection notification. 
     * aSender.onConnectionOpened = yourOnConnectionOpened;
     */
    this.onConnectionOpened = function(duplexChannelEventArgs) {};

	/**
     * The event is invoked when the connection with the duplex input channel was closed.
     * @param {DuplexChannelEventArgs} duplexChannelEventArgs
	 * @example
	 * // Set your handler to receive close connection notification.
     * aSender.onConnectionClosed = yourOnConnectionClosed;
     */
    this.onConnectionClosed = function(duplexChannelEventArgs) {};
    
	/**
     * Returns the channel id. It represents the service address.
     * @returns {String}
     */
    this.getChannelId = function()
    {
        return myChannelId;
    };

	/**
     * Returns the response receiver id. It uniquely represents this client at the service.
     * @returns {String}
     */
    this.getResponseReceiverId = function()
    {
        return myResponseReceiverId;
    };
    
	/**
     * Opens connection with the duplex input channel.<br/>
	 * The opening the connection contains the request to the message bus to get connected to the specified service.
     * @throws Throws error if connection could not be open.
     */
    this.openConnection = function()
    {
        if (this.isConnected())
        {
            throw new Error("Connection is already open.");
        }

        try
        {
            // Once the connection is open the code continues in _onConnectionOpened().
            myMessageBusOutputChannel.openConnection();
        }
        catch (err)
        {
            logError(myTracedObject + "failed to open connection.", err);
            closeConnection();
            throw err;
        }
    };
    
	/**
     * Closes connection with the duplex input channel.
     */
    this.closeConnection = function()
    {
        myMessageBusOutputChannel.closeConnection();
    };
    
	/**
     * Returns true if the connection with the duplex input channel is open.
     * @returns {Boolean}
     */
    this.isConnected = function()
    {
        return myMessageBusOutputChannel.isConnected();
    };
    
	/**
     * Sends the message to the duplex input channel.
     * @param {String | ArrayBuffer} message message to be sent
     * @throws Throws error if sending fails.
     */
    this.sendMessage = function(message)
    {
        if (!this.isConnected())
        {
            var aMessage = myTracedObject + "failed to send the message because the output channel is not connected.";
            logError(aMessage);
            throw new Error(aMessage);
        }

        try
        {
            // Note: do not send the response receiver id. It will be automatically assign in the message bus before forwarding the message to the service.
            //       It is done like this due to security reasons. So that some client cannot pretend other client just by sending a different id.
            var aMessage = new MessageBusMessage();
            aMessage.Request = 50;
            aMessage.Id = "";
            aMessage.MessageData = message;
            var aSerializedMessage = mySerializer.serialize(aMessage);
            myMessageBusOutputChannel.sendMessage(aSerializedMessage);
        }
        catch (err)
        {
            var aMessage = myTracedObject + "failed to send a message.";
            logError(aMessage, err);
            throw new Error(aMessage);
        }
    };
    
    // Is called when messageBusOutputChannel opened the connection to the message bus.
    // The method tells message bus which service shall be connected.
    function _onConnectionOpened(duplexChannelEventArgs)
    {
        try
        {
            // Tell message bus which service shall be associated with this connection.
            var aMessage = new MessageBusMessage();
            aMessage.Request = 20;
            aMessage.Id = myChannelId;
            var aSerializedMessage = mySerializer.serialize(aMessage);
            myMessageBusOutputChannel.sendMessage(aSerializedMessage);
        }
        catch (err)
        {
            logError(myTracedObject + "failed to open connection with message bus.", err);
            throw err;
        }
    }
    
    function _onConnectionClosed(duplexChannelEventArgs)
    {
        try
        {
            mySelf.onConnectionClosed(duplexChannelEventArgs);
        }
        catch (err)
        {
            logError("Detected a failure in the event handler.", err);
        }
    }
    
    function _onResponseMessageReceived(duplexChannelMessageEventArgs)
    {
        var aMessageBusMessage;
        try
        {
            aMessageBusMessage = mySerializer.deserialize(duplexChannelMessageEventArgs.Message);
        }
        catch (err)
        {
            logError(myTracedObject + "failed to deserialize the message.", err);
            return;
        }
        
        // If message bus confirmed this client is connected to the desired service.
        if (aMessageBusMessage.Request === 40)
        {
            // CONNECTION CONFIRMED.
            try
            {
                var anEventArgs = new DuplexChannelEventArgs(mySelf.getChannelId(), mySelf.getResponseReceiverId());
                mySelf.onConnectionOpened(anEventArgs);
            }
            catch (err)
            {
                logError("Detected a failure in the event handler.", err);
            }
        }
        else if (aMessageBusMessage.Request === 60)
        {
            try
            {
                var anEventArgs = new DuplexChannelMessageEventArgs(mySelf.getChannelId(), aMessageBusMessage.MessageData, mySelf.getResponseReceiverId());
                mySelf.onResponseMessageReceived(anEventArgs);
            }
            catch (err)
            {
                logError("Detected a failure in the event handler.", err);
            }
        }
    }
};

/**
 * Event arguments used to for connection related events. (e.g. onConnectionOpened, onConnectionClosed)
 * @class
 */
function DuplexChannelEventArgs(channelId, responseReceiverId)
{
    /**
     * Returns the channel id identifying the receiver of request messages. (e.g. ws://127.0.0.1:8090/).
     */
    this.ChannelId = channelId;
    
    /**
     * Returns the unique logical id identifying the receiver of response messages.
     */
    this.ResponseReceiverId = responseReceiverId;
};

/**
 * Event argument used to notify that duplex input channel received a message.
 * @class
 */
function DuplexChannelMessageEventArgs(channelId, message, responseReceiverId)
{
    /**
     * Returns the channel id identifying the receiver of request messages. (e.g. ws://127.0.0.1:8090/).
     */
    this.ChannelId = channelId;
    
    /**
     * Returns the message.
     */
    this.Message = message;
    
    /**
     * Returns the unique logical id identifying the receiver of response messages.
     */
    this.ResponseReceiverId = responseReceiverId;
};

/**
 * Duplex output channel using Websocket.
 * @class
 * @param {String} webSocketUri address of the service. (e.g. ws://127.0.0.1:8090/MyService/).
 * @param {String} [responseReceiverId = null] unique identifier of the client. If null then GUID will be generated.
 * @param {EneterProtocolFormatter | EasyProtocolFormatter} [protocolFormatter = null] formatter used to encode/decode messages
 * between output and input channel. So that the channel knows if the received message is 'OpenConnection', 'CloseConnection'
 * or 'DataMessage'. If null then default {@link EneterProtocolFormatter} is used.
 * 
 * @example
 * // Create the duplex output channel.
 * var anOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8077/MyService/", null);
 * 
 * // Subscribe for receving messages.
 * anOutputChannel.onResponseMessageReceived = onResponseMessageReceived;
 * 
 * // Open connection.
 * anOutputChannel.openConnection();
 * 
 * ...
 * 
 * // Send a message.
 * // Note: the message can be String or ArrayBuffer.
 * anOutputChannel.sendMessage("Hello World.");
 * 
 * ...
 * 
 * // Close connection when not needed.
 * anOutputChannel.closeConnection();
 * 
 * ...
 * 
 * // Your event handler to process received response messages.
 * function onResponseMessageReceived(duplexChannelMessageEventArgs) {
 *     var aMessage = duplexChannelMessageEventArgs.Message;
 *     
 *     ...
 * }
 * 
 */
function WebSocketDuplexOutputChannel(webSocketUri, responseReceiverId, protocolFormatter)
{
    // Private data members.
    var myChannelId = webSocketUri;
    var myResponseReceiverId = (responseReceiverId) ? responseReceiverId : webSocketUri + "_" + getGuid();
    var myProtocolFormatter = (protocolFormatter) ? protocolFormatter : new EneterProtocolFormatter();
    var myWebSocket = null;
    var myTracedObject = "WebSocketDuplexOutputChannel " + webSocketUri + " ";
    

    /**
     * The event is invoked when a response message was received.
     * @param {DuplexChannelMessageEventArgs} duplexChannelMessageEventArgs
     */
    this.onResponseMessageReceived = function(duplexChannelMessageEventArgs) {};

    /**
     * The event is invoked when the connection with the duplex input channel was opened.
     * @param {DuplexChannelEventArgs} duplexChannelEventArgs
     */
    this.onConnectionOpened = function(duplexChannelEventArgs) {};

    /**
     * The event is invoked when the connection with the duplex input channel was closed.
     * @param {DuplexChannelEventArgs} duplexChannelEventArgs
     */
    this.onConnectionClosed = function(duplexChannelEventArgs) {};

    /**
     * Returns the channel id. It represents the service address.
     * @returns {String}
     */
    this.getChannelId = function()
    {
        return myChannelId;
    };

    /**
     * Returns the response receiver id. It uniquely represents this client at the service.
     * @returns {String}
     */
    this.getResponseReceiverId = function()
    {
        return myResponseReceiverId;
    };

    /**
     * Opens connection with the duplex input channel.
     * @throws Throws error if connection could not be open.
     */
    this.openConnection = function()
    {
        if (this.isConnected())
        {
            throw new Error("Connection is already open.");
        }

        try
        {
            myWebSocket = new WebSocket(myChannelId);

            // We want to use ArrayBuffer for data transfer.
            myWebSocket.binaryType = "arraybuffer";

            // Subscribe in WebSocket to receive notifications.
            var aSelf = this;
            myWebSocket.onopen = function(evt)
            {
                // Ask duplex input channel to open the connection.
                var anEncodedOpenConnection = myProtocolFormatter.encodeOpenConnectionMessage(myResponseReceiverId);
                if (anEncodedOpenConnection !== null)
                {
                    myWebSocket.send(anEncodedOpenConnection);
                }

                // Notify the connection is open.
                var aDuplexChannelEventArgs = new DuplexChannelEventArgs(myChannelId, myResponseReceiverId);
                aSelf.onConnectionOpened(aDuplexChannelEventArgs);
            };
            myWebSocket.onclose = function(evt)
            {
                aSelf.closeConnection();
            };
            myWebSocket.onmessage = function(evt)
            {
                // Decode incoming message.
                var aProtocolMessage = null;
                try
                {
                    aProtocolMessage = myProtocolFormatter.decodeMessage(evt.data);
                }
                catch (err)
                {
                    logError(myTracedObject + "failed to decode the incoming message.", err);
                    aProtocolMessage = new ProtocolMessage("Unknonw", "", null);
                }

                try
                {
                    // Notify the message was received.
                    var aDuplexChannelMessageEventArgs = new DuplexChannelMessageEventArgs(myChannelId, aProtocolMessage.Message, myResponseReceiverId);
                    aSelf.onResponseMessageReceived(aDuplexChannelMessageEventArgs);
                }
                catch (err)
                {
                    logError(myTracedObject + "detected a failure in the event handler.", err);
                }
            };

            myWebSocket.onerror = function(evt)
            {
                console.error(myTracedObject + "detected a WebSocket error.");
            };
        }
        catch (err)
        {
            // Note: In case the service is not running the openConnection will not fail
            // but onClose() callback will be called - this is the JavaScript WebSocket behavior.
            logError(myTracedObject + "failed to open connection.", err);
            closeConnection();
            throw err;
        }
    };

    /**
     * Closes connection with the duplex input channel.
     */
    this.closeConnection = function()
    {
        if (myWebSocket !== null)
        {
            try
            {
                myWebSocket.close();
            }
            catch (err)
            {
            }

            myWebSocket = null;
            
            try
            {
                // Notify the connection is closed.
                var aDuplexChannelEventArgs = new DuplexChannelEventArgs(myChannelId, myResponseReceiverId);
                this.onConnectionClosed(aDuplexChannelEventArgs);
            }
            catch (err)
            {
                logError(myTracedObject + "detected a failure in the event handler.", err);
            }
        }
    };

    /**
     * Returns true if the connection with the duplex input channel is open.
     * @returns {Boolean}
     */
    this.isConnected = function()
    {
        if (myWebSocket === null)
        {
            return false;
        }

        return true;
    };

    /**
     * Sends the message to the duplex input channel.
     * @param {String | ArrayBuffer} message message to be sent
     * @throws Throws error if sending fails.
     */
    this.sendMessage = function(message)
    {
        if (this.isConnected() === false)
        {
            var anErrorMsg = myTracedObject + "failed to send the message because connection is not open.";
            logError(anErrorMsg);
            throw new Error(anErrorMsg);
        }
        
        if (message === null)
        {
            var anErrorMsg = myTracedObject + "failed to send the message because the message was null.";
            logError(anErrorMsg);
            throw new Error(anErrorMsg);
        }
        
        if (message.constructor !== String &&
            message.constructor !== ArrayBuffer &&
            message.constructor !== Uint8Array &&
            message.constructor !== Int8Array)
        {
            var anErrorMsg = myTracedObject + "failed to send the message because the message is not String or byte[]";
            logError(anErrorMsg);
            throw new Error(anErrorMsg);
        }

        try
        {
            var anEncodedMessage = myProtocolFormatter.encodeRequestMessage(myResponseReceiverId, message);
            myWebSocket.send(anEncodedMessage);
        }
        catch (err)
        {
            logError(myTracedObject + "failed to send the message.", err);
            throw err;
        }
    };
};

/**
 * Message decoded by the protocol formatter.<br/>
 * The protocol formatter is used for the internal communication between output and input channel.
 * When the channel receives a message it uses the protocol formatter to figure out if is is
 * 'Open Connection', 'Close Connection' or 'Data Message'.
 * Protocol formatter decodes the message and returns ProtocolMessage.
 * @class
 */
function ProtocolMessage(messageType, responseReceiverId, message)
{
    /**
     * Type of the message. This parameter is not used in Eneter for Javascript. 
     */
    this.MessageType = messageType;
    
    /**
     * Client id. This parameter is not used in Eneter for Javascript.
     */
    this.ResponseReceiverId = responseReceiverId;
    
    /**
     * Decoded message data.
     */
    this.Message = message;
}

/**
 * Default Eneter encoding/decoding. It is the default Eneter protocol formatter which can be used in all types of communication.<br/>
 * <br/>
 * <b>Encoding of open connection message:</b><br/>
 * 6 bytes - header: ENETER<br/>
 * 1 byte - endianess: 10 little endian, 20 big endian<br/>
 * 1 byte - string encoding: 10 UTF8, 20 UTF16<br/>
 * 1 byte - message type: 10 for open connection<br/>
 * 4 bytes - length: 32 bit integer indicating the size (in bytes) of the following string<br/>
 * x bytes - responseReceiverId: client id string<br/>
 * <br/>
 * <b>Encoding of close connection message:</b><br/>
 * The close connection message is not used. The connection is considered closed when the socket is closed.<br/>
 * <br/>
 * <b>Encoding of data message:</b><br/>
 * 6 bytes - header: ENETER<br/>
 * 1 byte - endianess: 10 little endian, 20 big endian<br/>
 * 1 byte - string encoding: 10 UTF8, 20 UTF16<br/>
 * 1 byte - message type: 40 for data message<br/>
 * 4 bytes - length: 32 bit integer indicating the size (in bytes) of the following string<br/>
 * x bytes - responseReceiverId: client id string<br/>
 * 1 byte - message data type: 10 bytes, 20 string<br/>
 * 4 bytes - length: 32 bit integer indicating the size (in bytes) of the following data.<br/>
 * y bytes - message data: message data<br/>
 * 
 * @class
 */
function EneterProtocolFormatter()
{
    /**
     * Encodes open connection message.
     * @param {String} responseReceiverId id of the client opening the connection.
     */
    this.encodeOpenConnectionMessage = function(responseReceiverId)
    {
        return encodeMessage(10, responseReceiverId, null);
    };
    
    // Not needed method - because the socket can be just closed.
    //this.encodeCloseConnectionMessage = function(responseReceiverId)
    //{
    //    return encodeMessage(20, responseReceiverId, null);
    //};
    
    /**
     * Encodes the request message.
     * @param {String} responseReceiverId id of the client which sends the message.
     * @param {String | ArrayBuffer} messageData message which shall be sent.
     */
    this.encodeRequestMessage = function(responseReceiverId, messageData)
    {
        if (messageData === null)
        {
            throw new Error("Input parameter messageData is null. It must be instance of Strint or ArrayBuffer"); 
        }
        
        return encodeMessage(40, responseReceiverId, messageData);
    };
    
    /**
     * Decodes incoming message.
     * @param {ArrayBuffer | String} arrayBufferMessage encoded message.
     */
    this.decodeMessage = function(arrayBufferMessage)
    {
        // Create like stream reader.
        var aDynamicDataView = new DynamicDataView(arrayBufferMessage);
        var aReader = new EncoderDecoder(aDynamicDataView);

        // Read header ENETER
        if (aReader.readByte() !== 69 || aReader.readByte() !== 78 || aReader.readByte() !== 69 ||
            aReader.readByte() !== 84 || aReader.readByte() !== 69 || aReader.readByte() !== 82)
        {
            throw new Error("Uknown message header.");
        }

        // Get endianess of the message.
        var anEndianEncodingId = aReader.readByte();
        if (anEndianEncodingId !== 10 && anEndianEncodingId !== 20)
        {
            throw new Error("Uknown endianess.");
        }
        var anIsLittleEndian = anEndianEncodingId === 10;
        
        // Get string encoding (UTF8 or UTF16)
        var aStringEncodingId = aReader.readByte();
        if (aStringEncodingId !== 10 && aStringEncodingId !== 20)
        {
            throw new Error("Uknown string encoding");
        }

        // Get the message type.
        var aMessageType = aReader.readByte();

        // If it is response message.
        if (aMessageType === 40)
        {
            // Get response receiver id.
            var aSize = aReader.readInt32(anIsLittleEndian);

            // Note: we can ignore the response receicer id on the client.
            // Note: the size of response receiver id should be 0 here on the
            // client side.
            aReader.skipBytes(aSize);

            // Get message serialization type (string or byte[]).
            var aSerializationType = aReader.readByte();

            // If bytes.
            if (aSerializationType === 10)
            {
                // Get bytes in ArrayBuffer.
                var aBytes = aReader.readPlainByteArray(anIsLittleEndian);
                var aProtocolMessage = new ProtocolMessage("MessageReceived", "", aBytes);

                return aProtocolMessage;
            }

            // If string.
            if (aSerializationType === 20)
            {
                var anEncoding;

                // If the incoming string is UTF-8.
                if (aStringEncodingId === 10)
                {
                    anEncoding = new Utf8Encoding();
                }
                // If the incoming string is UTF-16 LE
                else if (aStringEncodingId === 20 && anEndianEncodingId === 10)
                {
                    anEncoding = new Utf16LeEncoding();
                }
                // If the incoming string is UTF-16 BE
                else if (aStringEncodingId === 20 && anEndianEncodingId === 20)
                {
                    anEncoding = new Utf16BeEncoding();
                }
                else
                {
                    throw new Error("Uknown string encoding of message data.");
                }
                
                var aStr = aReader.readPlainString(anEncoding, anIsLittleEndian);

                var aProtocolMessage = new ProtocolMessage("MessageReceived", "", aStr);
                return aProtocolMessage;
            }
            
            throw new Error("Uknown type of message data.");
        }

        throw new Error("Uknown type of message.");
    };
    
    var encodeMessage = function(messageType, responseReceiverId, messageData)
    {
        var anInitialMessageSize = 100;
        var aDynamicDataView = new DynamicDataView(anInitialMessageSize);
        var aWriter = new EncoderDecoder(aDynamicDataView);

        // Write message header: ENETER.
        aWriter.writeByte(69);
        aWriter.writeByte(78);
        aWriter.writeByte(69);
        aWriter.writeByte(84);
        aWriter.writeByte(69);
        aWriter.writeByte(82);
        
        aWriter.writeByte(10); // indicates little endian
        aWriter.writeByte(20); // indicates UTF16
        aWriter.writeByte(messageType); // indicate if it is open connection or request message

        var anEncoding = new Utf16LeEncoding();
        
        // responseReceiverId
        aWriter.writePlainString(responseReceiverId, anEncoding, true);
        
        if (messageData !== null)
        {
            if (messageData.constructor === String)
            {
                aWriter.writeByte(20); // indicates the message is string
                aWriter.writePlainString(messageData, anEncoding, true);
            }
            // ArrayBuffer
            else
            {
                aWriter.writeByte(10); // indicates the message is bytes
                aWriter.writePlainByteArray(messageData, true);
            }
        }
        
        return aDynamicDataView.getArrayBuffer();
    }
};

/**
 * Simple and very fast encoding/decoding.
 * The simplicity of this formatting provides high performance and easy portability to various platforms.
 * However this formatting cannot be used when recovery of the broken connection is needed.<br/>
 * <br/>
 * <b>Encoding of open connection message:</b><br/>
 * n.a. - the open connection message is not used. The connection is considered open when the socket is open.<br/>
 * <br/>
 * <b>Encoding of close connection message:</b><br/>
 * n.a. - the close connection message is not used. The connection is considered closed then the socket is closed.<br/>
 * <br/>
 * <b>Encoding of data message:</b><br/>
 * 1 byte - type of data: 10 string in UTF8, 40 bytes<br/>
 * 4 bytes - length: 32 bit integer indicating the size (in bytes) of message data.<br/>
 * x bytes - message data<br/>
 * 
 * @class
 * @param {Boolean} [isLittleEndian=true] Indicates if size of data is encoded in little endian or big endian.
 * The default value is true - the little endian is used. 
 * 
 * @example
 * // Create EasyProtocolFormatter.
 * // Note: Be sure the service side uses EasyProtocolFormatter too.
 * //       Otherwise it will not work because they will not understand each other!
 * EasyProtocolFormatter aProtocolFormatter = new EasyProtocolFormatter();
 * 
 * // Create the duplex output channel which uses the specified protocol formatter.
 * var anOutputChannel = new WebSocketDuplexOutputChannel("ws://127.0.0.1:8077/MyService/", null, aProtocolFormatter);
 * 
 * // Subscribe for receving messages.
 * anOutputChannel.onResponseMessageReceived = onResponseMessageReceived;
 * 
 * // Open connection.
 * anOutputChannel.openConnection();
 * 
 * ...
 * 
 * // Send a message.
 * // Note: the message can be String or ArrayBuffer.
 * anOutputChannel.sendMessage("Hello World.");
 * 
 * ...
 * 
 * // Close connection when not needed.
 * anOutputChannel.closeConnection();
 * 
 * ...
 * 
 * // Your event handler to process received response messages.
 * function onResponseMessageReceived(duplexChannelMessageEventArgs) {
 *     var aMessage = duplexChannelMessageEventArgs.Message;
 *     
 *     ...
 * }
 */
function EasyProtocolFormatter(isLittleEndian)
{
    var myIsLittleEndian = (typeof isLittleEndian === "undefined") ? true : isLittleEndian;
    
    /**
     * Returns null.
     */
    this.encodeOpenConnectionMessage = function(responseReceiverId)
    {
        return null;
    };
    
    // Not needed method - because the socket can be just closed.
    //this.encodeCloseConnectionMessage = function(responseReceiverId)
    //{
    //    return encodeMessage(20, responseReceiverId, null);
    //};
    
    /**
     * Encodes the message.
     * @param responseReceiverId id of the client that wants to send the message. This parameter is not used.
     * @param messageData {String | ArrayBuffer} message which shall be sent.
     */
    this.encodeRequestMessage = function(responseReceiverId, messageData)
    {
        if (messageData === null)
        {
            throw new Error("Input parameter messageData is null. It must be instance of Strint or ArrayBuffer"); 
        }
        
        var anInitialMessageSize = 100;
        var aDynamicDataView = new DynamicDataView(anInitialMessageSize);
        var aWriter = new EncoderDecoder(aDynamicDataView);
        
        aWriter.write(messageData, myIsLittleEndian);
        
        return aDynamicDataView.getArrayBuffer();
    };
    
    /**
     * Decodes the incoming message.
     * @param arrayBufferMessage {ArrayBuffer} encoded message data.
     * @returns {ProtocolMessage}
     */
    this.decodeMessage = function(arrayBufferMessage)
    {
        var aDynamicDataView = new DynamicDataView(arrayBufferMessage);
        var aReader = new EncoderDecoder(aDynamicDataView);
        
        var aMessageData = aReader.read(myIsLittleEndian);
        var aProtocolMessage = new ProtocolMessage("MessageReceived", "", aMessageData);
        return aProtocolMessage;
    };
};


//API: no
//Helper class for encoding / decoding data. 
function EncoderDecoder(dynamicDataView)
{
    var STRING_UTF8_ID = 10;
    var STRING_UTF16_LE_ID = 20;
    var STRING_UTF16_BE_ID = 30;
    var BYTES_ID = 40;
    
    var myDynamicDataView = dynamicDataView;
    var myIdx = 0;

    
    this.write = function(data, isLittleEndian)
    {
        if (data.constructor === String)
        {
            this.writeString(data, isLittleEndian);
        }
        // 
        else if (data.constructor === ArrayBuffer)
        {
            this.writeByteArray(data, isLittleEndian);
        }
        else
        {
            throw new Error("Only ArrayBuffer or String is supported.");
        }
    }
    
    this.writeString = function(str, isLittleEndian)
    {
        this.writeByte(STRING_UTF8_ID);
        this.writePlainString(str, new Utf8Encoding(), isLittleEndian);
    }
    
    this.writeByteArray = function(data, isLittleEndian)
    {
        this.writeByte(BYTES_ID);
        this.writePlainByteArray(data, isLittleEndian);
    }
    
    this.read = function(isLittleEndian)
    {
        var aDataType = this.readByte();
        var aResult;
        
        if (aDataType === BYTES_ID)
        {
            aResult = this.readPlainByteArray(isLittleEndian);
        }
        else
        {
            var anEncoding;
            if (aDataType === STRING_UTF8_ID)
            {
                anEncoding = new Utf8Encoding();
            }
            else if (aDataType === STRING_UTF16_LE_ID)
            {
                anEncoding = new Utf16LeEncoding();
            }
            else if (aDataType === STRING_UTF16_BE_ID)
            {
                anEncoding = new Utf16BeEncoding();
            }
            else
            {
                throw new Error("Unknown encoding of string. Only UTF8 and UTF16 is supported.");
            }
            
            aResult = this.readPlainString(anEncoding, isLittleEndian);
        }
        
        return aResult;
    }
    
    this.writePlainString = function(str, encoding, isLittleEndian)
    {
        var aSize = encoding.stringToBytes(myDynamicDataView, myIdx + 4, str);
        myDynamicDataView.setInt32(myIdx, aSize, isLittleEndian);
        myIdx += 4 + aSize;
    }
    
    this.readPlainString = function(stringEncoding, isLittleEndian)
    {
        var aSize = this.readInt32(isLittleEndian);
        
        var aResult = stringEncoding.stringFromBytes(myDynamicDataView, myIdx, aSize);
        myIdx += aSize;
        
        return aResult;
    }
    
    this.readPlainByteArray = function(isLittleEndian)
    {
        var aLength = this.readInt32(isLittleEndian);
        var anArrayBuffer = this.readBytes(aLength);
        return anArrayBuffer;
    }
    
    this.writePlainByteArray = function(arrayBuffer, isLittleEndian)
    {
        // Length of the array.
        this.writeInt32(arrayBuffer.byteLength, isLittleEndian);
        
        // Bytes.
        this.writeBytes(arrayBuffer);
    }
    
    this.readBytes = function(size)
    {
        var anArrayBuffer = myDynamicDataView.readBytes(myIdx, size);
        myIdx += size;
        return anArrayBuffer;
    };
    
    this.writeBytes = function(arrayBuffer)
    {
        myDynamicDataView.writeBytes(myIdx, arrayBuffer);
        myIdx += arrayBuffer.byteLength;
    }

    this.skipBytes = function(size)
    {
        myIdx += size;
    }
    
    this.readByte = function()
    {
        return myDynamicDataView.getUint8(myIdx++);
    };
    
    this.writeByte = function(value)
    {
        myDynamicDataView.setUint8(myIdx++, value);
    };

    this.writeInt32 = function(value, isLittleEndian)
    {
        myDynamicDataView.setInt32(myIdx, value, isLittleEndian);
        myIdx += 4;
    };
    
    this.readInt32 = function(isLittleEndian)
    {
        var aResult = myDynamicDataView.getInt32(myIdx, isLittleEndian);
        myIdx += 4;
        return aResult;
    };
};


//API: no
// UTF8 encoding convertor.
function Utf8Encoding()
{
    this.stringFromBytes = function(dynamicDataView, beginIdx, size)
    {
        var aResult = "";
        var aCode;
        var i;
        var aValue;
        for (i = 0; i < size; i++)
        {
            aValue = dynamicDataView.getUint8(beginIdx + i);

            // If one byte character.
            if (aValue <= 0x7f)
            {
                aResult += String.fromCharCode(aValue);
            }
            // If mutlibyte character.
            else if (aValue >= 0xc0)
            {
                // 2 bytes.
                if (aValue < 0xe0)
                {
                    aCode = ((dynamicDataView.getUint8(beginIdx + i++) & 0x1f) << 6) |
                            (dynamicDataView.getUint8(beginIdx + i) & 0x3f);
                }
                // 3 bytes.
                else if (aValue < 0xf0)
                {
                    aCode = ((dynamicDataView.getUint8(beginIdx + i++) & 0x0f) << 12) |
                            ((dynamicDataView.getUint8(beginIdx + i++) & 0x3f) << 6) |
                            (dynamicDataView.getUint8(beginIdx + i) & 0x3f);
                }
                // 4 bytes.
                else
                {
                    // turned into two characters in JS as surrogate pair
                    aCode = (((dynamicDataView.getUint8(beginIdx + i++) & 0x07) << 18) |
                            ((dynamicDataView.getUint8(beginIdx + i++) & 0x3f) << 12) |
                            ((dynamicDataView.getUint8(beginIdx + i++) & 0x3f) << 6) |
                            (dynamicDataView.getUint8(beginIdx + i) & 0x3f)) - 0x10000;
                    // High surrogate
                    aResult += String.fromCharCode(((aCode & 0xffc00) >>> 10) + 0xd800);
                    // Low surrogate
                    aCode = (aCode & 0x3ff) + 0xdc00;
                }
                aResult += String.fromCharCode(aCode);
            } // Otherwise it's an invalid UTF-8, skipped.
        }
        
        return aResult;
    }
    
    this.stringToBytes = function(dynamicDataView, beginIdx, str)
    {
        var aLength = str.length;
        var aResultSize = 0;
        var aCode;
        var i;
        for (i = 0; i < aLength; i++)
        {
            aCode = str.charCodeAt(i);
            if (aCode <= 0x7f)
            {
                dynamicDataView.setUint8(beginIdx + aResultSize++, aCode);
            }
            // 2 bytes 
            else if (aCode <= 0x7ff)
            {
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0xc0 | (aCode >>> 6 & 0x1f));
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0x80 | (aCode & 0x3f));
            }
            // 3 bytes
            else if (aCode <= 0xd700 || aCode >= 0xe000)
            {
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0xe0 | (aCode >>> 12 & 0x0f));
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0x80 | (aCode >>> 6 & 0x3f));
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0x80 | (aCode & 0x3f));
            }
            else
            // 4 bytes, surrogate pair
            {
                aCode = (((aCode - 0xd800) << 10) | (str.charCodeAt(++i) - 0xdc00)) + 0x10000;
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0xf0 | (aCode >>> 18 & 0x07));
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0x80 | (aCode >>> 12 & 0x3f));
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0x80 | (aCode >>> 6 & 0x3f));
                dynamicDataView.setUint8(beginIdx + aResultSize++, 0x80 | (aCode & 0x3f));
            }
        }
        
        return aResultSize;
    }
}

//API: no
// UTF16 Little Endian encoding convertor. 
function Utf16LeEncoding()
{
    // note: true means little-endian.
    var myUtf16EncodingBase = new Utf16EncodingBase(true);
    
    this.stringFromBytes = function(dynamicDataView, beginIdx, size)
    {
        return myUtf16EncodingBase.stringFromBytes(dynamicDataView, beginIdx, size);
    }
    
    this.stringToBytes = function(dynamicDataView, beginIdx, str)
    {
        return myUtf16EncodingBase.stringToBytes(dynamicDataView, beginIdx, str);
    }
}

//API: no
// UTF16 Big Endian encoding convertor.
function Utf16BeEncoding()
{
    // note: false means big-endian.
    var myUtf16EncodingBase = new Utf16EncodingBase(false);
    
    this.stringFromBytes = function(dynamicDataView, beginIdx, size)
    {
        return myUtf16EncodingBase.stringFromBytes(dynamicDataView, beginIdx, size);
    }
    
    this.stringToBytes = function(dynamicDataView, beginIdx, str)
    {
        return myUtf16EncodingBase.stringToBytes(dynamicDataView, beginIdx, str);
    }
}

//API: no
// Base class for UTF16 encoding convertor.
function Utf16EncodingBase(isLittleEndian)
{
    var myIsLittleEndian = isLittleEndian;
    
    this.stringFromBytes = function(dynamicDataView, beginIdx, size)
    {
        var aResult = "";
        for (var i = 0; i < size; ++i)
        {
            aResult += String.fromCharCode(dynamicDataView.getUint16(beginIdx + i++, myIsLittleEndian));
        }
        return aResult;
    }
    
    this.stringToBytes = function(dynamicDataView, beginIdx, str)
    {
        var aLength = str.length;
        var ch;
        for (var i = 0; i < aLength; ++i)
        {
            ch = str.charCodeAt(i);
            dynamicDataView.setUint16(beginIdx + i * 2, ch, myIsLittleEndian);
        }
        
        var aResultSize = aLength * 2;
        return aResultSize;
    }
}

//API: no
// Dynamic data view which extends automatically
function DynamicDataView(arrayBufferOrSize)
{
    var mySize;
    var myArrayBuffer;
    
    if (arrayBufferOrSize.constructor === ArrayBuffer)
    {
        mySize = arrayBufferOrSize.byteLength;
        myArrayBuffer = arrayBufferOrSize;
    }
    else
    {
        mySize = arrayBufferOrSize;
        myArrayBuffer = new ArrayBuffer(mySize);
    }
    
    var myDataView = new DataView(myArrayBuffer);

    
    this.getArrayBuffer = function()
    {
        return myArrayBuffer;
    }
    
    this.readBytes = function(idx, size)
    {
        var anArrayBuffer = myDataView.buffer;
        
        // Get bytes in ArrayBuffer.
        var aResult = anArrayBuffer.slice(idx, idx + size);
        return aResult;
    }
    
    this.writeBytes = function(idx, arrayBuffer)
    {
        var aMinimalSize = idx + arrayBuffer.byteLength;
        expand(aMinimalSize);
        
        // Copy incoming array buffer.
        new Uint8Array(myArrayBuffer, idx).set(new Uint8Array(arrayBuffer));
    }
    
    this.getInt32 = function(idx, isLittleEndian)
    {
        return myDataView.getInt32(idx, isLittleEndian);
    }
    
    this.setInt32 = function(idx, value, isLittleEndian)
    {
        expand(idx + 4);
        myDataView.setInt32(idx, value, isLittleEndian);
    }
    
    this.getUint16 = function(idx, isLittleEndian)
    {
        return myDataView.getUint16(idx, isLittleEndian);
    }
    
    this.setUint16 = function(idx, value, isLittleEndian)
    {
        expand(idx + 2);
        myDataView.setUint16(idx, value, isLittleEndian);
    }
    
    this.getUint8 = function(idx)
    {
        return myDataView.getUint8(idx);
    }
    
    this.setUint8 = function(idx, value)
    {
        expand(idx + 1);
        myDataView.setUint8(idx, value);
    }
    
    var expand = function(minimalSize)
    {
        if (minimalSize <= mySize)
        {
            // nothing to do.
            return;
        }
        
        // Create new
        var aNewSize = minimalSize + 50;
        var aNewArrayBuffer = new ArrayBuffer(aNewSize);
        
        // Copy
        new Uint8Array(aNewArrayBuffer).set(new Uint8Array(myArrayBuffer));
        
        // Set new
        mySize = aNewSize;
        myArrayBuffer = aNewArrayBuffer;
        myDataView = new DataView(myArrayBuffer);
    }
}


// API: no
// Helper method creating GUID.
function getGuid()
{
    var aGuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
            .replace(/[xy]/g, function(c)
            {
                var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });

    return aGuid;
};

// API: no
// Helper method to check if a string is null or empty.
function isNullOrEmpty(stringValue)
{
    return stringValue === null || stringValue === "";
};

// API: no
// HashMap class
function EneterHashMap()
{
    var myLength = 0;
    var myItems = {};

    this.put = function(key, value)
    {
        if (!this.containsKey(key))
        {
            ++myLength;
        }
        myItems[key] = value;
    }

    this.get = function(key)
    {
        return this.containsKey(key) ? myItems[key] : null;
    }

    this.containsKey = function(key)
    {
        return myItems.hasOwnProperty(key);
    }
   
    this.remove = function(key)
    {
        if (this.containsKey(key))
        {
            var aRemovedItem = this.items[key];
            --myLength;
            
            delete myItems[key];
            
            return aRemovedItem;
        }
        else
        {
            return null;
        }
    }

    this.keys = function()
    {
        var aKeys = [];
        for (var k in myItems)
        {
            if (this.containsKey(k))
            {
                aKeys.push(k);
            }
        }
        return aKeys;
    }

    this.values = function()
    {
        var aValues = [];
        for (var k in myItems)
        {
            if (this.containsKey(k))
            {
                aValues.push(myItems[k]);
            }
        }
        return aValues;
    }

    this.clear = function()
    {
        myItems = {}
        myLength = 0;
    }
};

function logError(message, exception)
{
    var anExceptionMessage;
    if (typeof exception !== "undefined")
    {
        if (typeof exception.stack === "undefined")
        {
            anExceptionMessage = exception.message;
        }
        else
        {
            anExceptionMessage = exception.stack;
        }
    }
    else
    {
        anExceptionMessage = "";
    }
    
    console.error(message, anExceptionMessage);
};
