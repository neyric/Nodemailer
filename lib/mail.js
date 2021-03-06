var SMTPClient = require("./smtp").SMTPClient,
    mimelib = require("./mime");

/*
 * Version constants
 */
var X_MAILER_NAME = "Nodemailer",
    X_MAILER_VERSION = "0.1.6; +http://www.nodemailer.org";

/**
 * mail
 * 
 * Provides an API to send e-mails with Node.js through a SMTP server.
 * This API is unicode friendly, you don't have to escape non-ascii chars.
 * 
 * NB! Before sending any e-mails, update mail.SMTP with correct values
 * 
 **/


// EXPOSE TO THE WORLD

/**
 * mail.SMTP -> Object
 * 
 * Configuration object, keeps the needed values to connect to the SMTP server
 * 
 *   - **host** Hostname of the SMTP server (required)
 *   - **port** SMTP server port, defaults to 25
 *   - **hostname** hostname of the local server, needed for identifying,
 *     defaults to *untitled.server*
 *   - **use_authentication** if set to *true* authentication procedure is
 *     run after a successful connection
 *   - **user** username for authentication
 *   - **pass** password for authentication
 **/
exports.SMTP = {
    host: false,
    port: false,
    hostname: false,
    use_authentication: false,
	ssl: false,
    user: false,
    pass: false
};

// Expose EmailMessage for the world
exports.EmailMessage = EmailMessage;

/**
 * mail.send_mail(params, callback) -> undefined
 * - params (Object): e-mail data
 * - callback (Function): will be run after completion
 * 
 * Shortcut function to send e-mails. See EmailMessage for param structure
 **/
exports.send_mail = function(params, callback){
    var em = new EmailMessage(params);
    em.send(callback);
};

var gencounter = 0;

/**
 * new mail.EmailMessage(params)
 * - params (Object): message data (can be altered afterwards)
 * 
 * Creates an object to send an e-mail.
 * 
 * params can hold the following data
 * 
 *   - **sender** e-mail address of the sender
 *   - **headers** an object with custom headers.
 *     `{"X-Myparam": "test", "Message-ID":"12345"}`
 *   - **to** comma separated list of TO: addressees
 *   - **cc** comma separated list of CC: addressees
 *   - **bcc** comma separated list of BCC: addressees
 *   - **reply_to** A reply-to address
 *   - **subject** Message subject
 *   - **body** Message body in plain text
 *   - **html** Message body in HTML format
 *   - **attachments** an array of attachements of {filename, contents, cid}
 *     filename (mandatory) is a String, contents can be String or Buffer,
 *     cid is optional.
 * 
 *   - **debug** if set, outputs the whole communication of SMTP server to console
 * 
 * All the params can be edited/added after defining the object
 * 
 * Usage:
 *     var em = EmailMessage();
 *     em.sender = '"Andris Reinman" <andris@node.ee>'
 *     em.to = 'andris@kreata.ee'
 *     em.body = "Hello world!";
 *     em.send(function(error, success){});
 *     
 *  NB! mail.SMTP needs to be set before sending any e-mails!
 **/
function EmailMessage(params){
    params = params || {};
    this.sender = params.sender;
    this.headers = params.headers || {};
    this.to = params.to;
    this.cc = params.cc;
    this.bcc = params.bcc;
    this.reply_to = params.reply_to;
    this.subject = params.subject || "";
    this.body = params.body || "";
    this.html = params.html;
    this.attachments = params.attachments || [];
    
    this.debug = !!params.debug;
    
    this.charset = "UTF-8";
    
    this.callback = null;
}

/**
 * mail.EmailMessage#prepareVariables() -> undefined
 * 
 * Prepares some needed variables
 **/
EmailMessage.prototype.prepareVariables = function(){
    if(this.html || this.attachments.length){
        this.content_multipart = true;
        this.content_mixed = !!this.attachments.length;
        this.content_boundary = "----NODEMAILER-"+(++gencounter)+"-"+Date.now();
        
        // defaults to multipart/mixed but if there's attachments with cid value set
        // use multipart/related - mail clients hide the duplicates this way
        var mixed = "mixed";
        for(var i=0, len=this.attachments.length; i<len;i++){
            if(this.attachments[i].cid){
                mixed = "related";
                break;
            }
        }
        this.content_type = "multipart/"+(this.content_mixed?mixed:"alternative")+
                "; boundary="+this.content_boundary;
    }else{
        this.content_multipart = false;
        this.content_type = "text/plain; charset="+this.charset;
        this.content_transfer_encoding = "quoted-printable";
    }
}

/**
 * mail.EmailMessage#generateHeaders() -> String
 * 
 * Generates a header string where lines are separated by \r\n
 **/
EmailMessage.prototype.generateHeaders = function(){
    
    var headers = [];
    
    // Mime
    headers.push([
        "X-Mailer",
        X_MAILER_NAME+" ("+X_MAILER_VERSION+")"
    ].join(": "));
    
    // add custom
    var keys = Object.keys(this.headers);
    for(var i=0, len=keys.length; i<len; i++){
        headers.push([
            upperFirst(keys[i].trim()),
            this.headers[keys[i]]
        ].join(": "));
    }
    
    // From
    var from = this.generateAddresses(this.sender,1, "fromAddress");
    if(from.length){
        headers.push([
            upperFirst("From"),
            from
        ].join(": "));    
    }
    
    // To
    var to = this.generateAddresses(this.to, 0, "toAddress");
    if(to.length){
        headers.push([
            upperFirst("To"),
            to
        ].join(": "));    
    }
    
    // CC
    var cc = this.generateAddresses(this.cc, 0, "toAddress");
    if(cc.length){
        headers.push([
            upperFirst("Cc"),
            cc
        ].join(": "));    
    }
    
    // BCC
    var bcc = this.generateAddresses(this.bcc, 0, "toAddress");
    if(bcc.length){
        headers.push([
            upperFirst("Bcc"),
            bcc
        ].join(": "));
    }

    //Reply-To
    var reply_to = this.generateAddresses(this.reply_to, 1);
    if(reply_to.length){
        headers.push([
            upperFirst("Reply-To"),
            reply_to
        ].join(": "));
    }
    
    // Subject
    headers.push([
        upperFirst("Subject"),
        this.subject && (hasUTFChars(this.subject) && 
              mimelib.encodeMimeWord(this.subject, "Q") || this.subject) || ''
    ].join(": "));

    // Mime
    headers.push([
        "MIME-Version",
        "1.0"
    ].join(": ")); 
    
    // Content-type
    headers.push([
        "Content-Type",
        this.content_type
    ].join(": ")); 
    
    if(!this.content_multipart){
        headers.push([
            "Content-Transfer-Encoding",
            this.content_transfer_encoding
        ].join(": "));
    }
    
    // output
    return headers.map(function(elm){
        return mimelib.foldLine(elm);
    }).join("\r\n");
}

/**
 * mail.EmailMessage#generateBody() -> String
 * 
 * Generates a body string. If this is a multipart message then different
 * parts will be separated by boundary, body+html are put into separate
 * multipart/alternate block
 **/
EmailMessage.prototype.generateBody = function(){

    if(!this.content_multipart){
        return this.body && mimelib.encodeQuotedPrintable(this.body) || "";
    }
    
    var body_boundary = this.content_mixed?
            "----NODEMAILER-"+(++gencounter)+"-"+Date.now():
            this.content_boundary,
        rows = [];
    

    if(this.content_mixed){
        rows.push("--"+this.content_boundary);
        rows.push("Content-Type: multipart/alternative; boundary="+body_boundary);
        rows.push("");
    }
    
    if(!this.body.trim() && this.html){
        this.body = mimelib.stripHTML(this.html);
    }
    
    // body
    rows.push("--"+body_boundary);
    rows.push("Content-Type: text/plain; charset="+this.charset);
    rows.push("Content-Transfer-Encoding: quoted-printable");
    rows.push("");
    // dots in the beginning of the lines will be replaced with double dots
    rows.push(mimelib.encodeQuotedPrintable(this.body.trim()).replace(/^\./gm,'..'));
    rows.push("");
    
    // html
    if(this.html){
        rows.push("--"+body_boundary);
        rows.push("Content-Type: text/html; charset="+this.charset);
        rows.push("Content-Transfer-Encoding: quoted-printable");
        rows.push("");
        rows.push(mimelib.encodeQuotedPrintable(this.html.trim()).replace(/^\./gm,'..'));
        rows.push("");
    }
    
    if(this.content_mixed){
        rows.push("--"+body_boundary+"--");
    }
    
    // attachments
    var current;
    for(var i=0; i<this.attachments.length; i++){

        current = {
            filename: hasUTFChars(this.attachments[i].filename)?
                    mimelib.encodeMimeWord(this.attachments[i].filename, "Q"):
                    this.attachments[i].filename.replace(/"/g,''),
            mime_type: getMimeType(this.attachments[i].filename),
            contents: this.attachments[i].contents instanceof Buffer?
                    this.attachments[i].contents:
                    new Buffer(this.attachments[i].contents, "utf-8"),
            disposition: "attachment",
            content_id: this.attachments[i].cid || ((++gencounter)+"."+Date.now()+"@"+exports.SMTP.hostname)
        };
        
        
        rows.push("--"+this.content_boundary);
        
        rows.push("Content-Type: "+current.mime_type+"; name=\""+current.filename+"\"");
        rows.push("Content-Disposition: "+current.disposition+"; filename=\""+current.filename+"\"");
        rows.push("Content-ID: <"+current.content_id+">");
        
        rows.push("Content-Transfer-Encoding: base64");
        rows.push("");
        
        // rows can't be too long, so base64 string will be cut to 78 char lines
        rows.push(current.contents.toString("base64").replace(/(.{78})/g,"$1\r\n"));
        
    }
    
    
    rows.push("--"+this.content_boundary+"--");
    
    return rows.join("\r\n");
    
}

/**
 * mail.EmailMessage#generateAddresses(addresses, limit, use_list) -> String
 * - addresses (String): Comma separated list of addresses
 * - limit (String): How many addresses will be used from the list
 * - use_list (String): property name where to add plain e-mail addresses
 * 
 * Parses an address string, finds the data and normalizes it. If use_string
 * is set, (ie. "toAddress") then found e-mail addresses are appended to
 * a list with the same name (this.toAddress). Plain e-mail addresses are
 * needed for the SMTP server.
 **/

EmailMessage.prototype.generateAddresses = function(addresses, limit, use_list){
    var parsed, output = [], current;
    
    limit = limit || 0;
    
    try{
        parsed = mimelib.parseAddresses(addresses);
    }catch(E){parsed = [];}
    
    var list = [];
    for(var i=0; i<parsed.length; i++){
        current = parsed[i];
        current.address = current.address && current.address.trim();
        if(!current.address)continue;
        
        list.push(current.address);
        
        if(hasUTFChars(current.address)){
            current.address = mimelib.encodeMimeWord(current.address, "Q");
        }
        
        if(current.name){
            current.name = upperFirst(current.name.trim(), true);
            if(hasUTFChars(current.name)){
                current.name = mimelib.encodeMimeWord(current.name, "Q");
            }
            current.name = '"' + current.name + '"';
            current.address = '<' + current.address.trim() +'>';
            output.push(current.name + " " +current.address);
        }else{
            output.push(current.address);
        }
    }

    if(limit && output.length>limit){
        output = output.slice(0, limit);
        list = list.slice(0, limit);
    }
    
    if(use_list){
        if(!this[use_list]){
            this[use_list] = list;
        }else{
            this[use_list] = this[use_list].concat(list);
        }
    }
    
    return output.join(", ");
}

/**
 * mail.EmailMessage#send(callback) -> undefined
 * - callback (Function): function to be called if sending succeedes or fails
 * 
 * Generates a full message body and forwards it to the SMTP server.
 * callback gets two params - error and success. If error is set, then
 * something bad happened, if there's no error but success is false, then
 * SMTP server failed and the message should be resent. If there's no error
 * and success is true, then the message was sent to the recipients
 **/
EmailMessage.prototype.send = function(callback){
    
    this.prepareVariables();
    
    var smtp = new SMTPClient(exports.SMTP.host, exports.SMTP.port, {
            hostname: exports.SMTP.hostname,
            use_authentication: exports.SMTP.use_authentication,
            user: exports.SMTP.user,
            pass: exports.SMTP.pass,
			ssl: exports.SMTP.ssl,
            debug: this.debug
        }), 
        headers = this.generateHeaders(),
        body = this.generateBody();
    
    smtp.on("error", function(error){
        callback && callback(error, null);
    });
    
    var commands = [];
    if(this.fromAddress){
        // should run once
        for(var i=0; i<this.fromAddress.length; i++){
            commands.push("MAIL FROM:<"+this.fromAddress[i]+">");
        }
    }
    if(this.toAddress){
        // should run once
        for(var i=0; i<this.toAddress.length; i++){
            commands.push("RCPT TO:<"+this.toAddress[i]+">");
        }
    }
    commands.push("DATA");
    
    process.nextTick(runCommands);
    
    // performs a waterfall of SMTP commands
    function runCommands(){
        var command = commands.shift();
        if(command){
            smtp.send(command, function(error, message){
                if(!error){
                    //console.log("Command '"+command+"' sent, response:\n"+message);
                    process.nextTick(runCommands);
                }else{
                    //console.log("Command '"+command+"' ended with error\n"+error.message);
                    smtp.close();
                    process.nextTick(function(){
                        callback && callback(error, null);
                    });
                }
            });
        }else
            process.nextTick(sendBody);
    }
    
    // Sends e-mail body to the SMTP server and finishes up
    function sendBody(){
        smtp.send(headers+"\r\n\r\n");
        smtp.send(body);
        smtp.send("\r\n.", function(error, message){
            if(!error){
                smtp.send("QUIT", function(error, message){
                    smtp.close();
                    process.nextTick(function(){
                        callback(null, true);
                    });
                });
            }else{
                smtp.close();
                process.nextTick(function(){
                    callback(null, false);
                });
            }
        });
    }
}

/**
 * getMimeType(filename) -> String
 * - filename (String): Failinimi, mille mime tüüpi otsida
 * 
 * Otsib välja faililaiendi alusel õige mime tüübi, vaikimisi
 * kui tüüpi ei leita on application/octet-stream
 **/
function getMimeType(filename){
    var defaultMime = "application/octet-stream",
        extension = filename && filename.substr(filename.lastIndexOf(".")+1).trim().toLowerCase();
    return extension && mimelib.mime_types[extension] || defaultMime;
}


/**
 * upperFirst(str) -> String
 * - str (String): string to be converted
 * 
 * Converts first letters upper case, other lower case
 * 
 * "x-name-value" -> "X-Name-Value"
 * 
 **/
function upperFirst(str, keepUpper){
    if(!keepUpper){
        str = str.toLowerCase();
    }
    return str.replace(/^\s*[a-z]|[\-\s][a-z]/g,function(c){
        return c.toUpperCase()
    });
}

/**
 * hasUTFChars(str) -> Boolean
 * - str (String): String to be checked for non-ascii chars
 * 
 * Tries to detect if a string has non-ascii characters. In this case the
 * string needs to be encoded before sent to the SMTP server
 **/
function hasUTFChars(str){
    var rforeign = /[^\u0000-\u007f]/;
    return !!rforeign.test(str);
}

