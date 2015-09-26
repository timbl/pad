// Notepad app 
//
// This is or was part of https://github.com/timbl/pad
//

document.addEventListener('DOMContentLoaded', function() {
// jQuery(document).ready(function() {


    var appPathSegment = 'app-pad.timbl.com'; // how to allocate this string and connect to 
    
    
    //////////////////////////////////////////////

    var kb = tabulator.kb;
    var fetcher = tabulator.sf;
    var ns = tabulator.ns;
    var dom = document;
    var me;
    var updater = new $rdf.sparqlUpdate(kb);
    var waitingForLogin = false;

    var ICAL = $rdf.Namespace('http://www.w3.org/2002/12/cal/ical#');
    var SCHED = $rdf.Namespace('http://www.w3.org/ns/pim/schedule#');
    var PAD = $rdf.Namespace('http://www.w3.org/ns/pim/pad#');
    var DC = $rdf.Namespace('http://purl.org/dc/elements/1.1/');
    var UI = $rdf.Namespace('http://www.w3.org/ns/ui#');
    var FOAF = $rdf.Namespace('http://xmlns.com/foaf/0.1/');
    
    var uri = window.location.href;
    var base = uri.slice(0, uri.lastIndexOf('/')+1);
    var subject_uri = base  + 'details.ttl#thisPad';
    
    window.document.title = "Pad";
    var forms_uri = base + 'forms.ttl';
//    var forms_uri = 'https://linkeddata.github.io/app-schedule/forms.ttl'; // CORS blocks
    var scriptBase = 'https://linkeddata.github.io/app-pad/';

    var subject = kb.sym(subject_uri);
    var thisInstance = subject;
    var detailsDoc = kb.sym(subject_uri.split('#')[0]);
         
    var padDoc = $rdf.sym(base + 'results.ttl');
    
    
    
    var div = document.getElementById('pad');
    
    // Utility functions
    
    var complainIfBad = function(ok, message) {
        if (!ok) {
            div.appendChild(tabulator.panes.utils.errorMessageBlock(dom, message, 'pink'));
        }
    };
    
    var clearElement = function(ele) {
        while (ele.firstChild) {
            ele.removeChild(ele.firstChild);
        }
        return ele;
    }
    
    var webOperation = function(method, uri, options, callback) {
        var xhr = $rdf.Util.XMLHTTPFactory();
        xhr.onreadystatechange = function (){
            if (xhr.readyState == 4){
                var ok = (!xhr.status || (xhr.status >= 200 && xhr.status < 300));
                callback(uri, ok, xhr.responseText, xhr);
            }
        };
        xhr.open(method, uri, true);
        if (options.contentType) {
            xhr.setRequestHeader('Content-type', options.contentType);
        }
        xhr.send(options.data ? options.data : undefined);
    };
    
    var webCopy = function(here, there, content_type, callback) {
        webOperation('GET', here,  {}, function(uri, ok, body, xhr) {
            if (ok) {
                webOperation('PUT', there, { data: xhr.responseText, contentType: content_type}, callback);
            } else {
                callback(uri, ok, "(on read) " + body, xhr);
            }
        });
    };
    ////////////////////////////   Subscription
    
    
    //  for all Link: uuu; rel=rrr  --->  { rrr: uuu }
    var linkRels = function(doc) {
        var links = {}; // map relationship to uri
        var linkHeaders = tabulator.fetcher.getHeader(doc, 'link');
        if (!linkHeaders) return null;
        linkHeaders.map(function(headerLine){
            headerLine.split(',').map(function(headerValue) {
                var arg = headerValue.trim().split(';');
                var uri = arg[0];
                arg.slice(1).map(function(a){
                    var key = a.split('=')[0].trim();
                    var val = a.split('=')[1].trim().replace(/["']/g, ''); // '"
                    if (key ==='rel') {
                        uri = uri.trim();
                        if (uri.slice(0,1) === '<') { // strip < >
                            uri = uri.slice(1, uri.length-1)
                        }
                        links[val] = uri;
                    }
                });
            });
        });
        return links;
    };

    //  for all Link: uuu; rel=rrr  --->  { rrr: uuu }
    var getUpdatesVia = function(doc) {
        var linkHeaders = tabulator.fetcher.getHeader(doc, 'updates-via');
        if (!linkHeaders) return null;
        return linkHeaders[0].trim();
    };


    var getChangesURI = function(doc, rel) {
        var links = linkRels(doc);
        if (!links[rel]) {
            console.log("No link header rel=" + rel + " on " + doc.uri);
            return null;
        }
        var uri = links[rel]
        var changesURI = $rdf.uri.join(links[rel], doc.uri);
        // console.log("Found rel=" + rel + " URI: " + changesURI);
        return changesURI;
    };


    
    //////////////////////// Accesss control


    // Two variations of ACL for this app, public read and public read/write
    // In all cases owner has read write control
    
    var genACLtext = function(docURI, aclURI, allWrite) {
        var g = $rdf.graph(), auth = $rdf.Namespace('http://www.w3.org/ns/auth/acl#');
        var a = g.sym(aclURI + '#a1'), acl = g.sym(aclURI), doc = g.sym(docURI);
        g.add(a, tabulator.ns.rdf('type'), auth('Authorization'), acl);
        g.add(a, auth('accessTo'), doc, acl)
        g.add(a, auth('agent'), me, acl);
        g.add(a, auth('mode'), auth('Read'), acl);
        g.add(a, auth('mode'), auth('Write'), acl);
        g.add(a, auth('mode'), auth('Control'), acl);
        
        a = g.sym(aclURI + '#a2');
        g.add(a, tabulator.ns.rdf('type'), auth('Authorization'), acl);
        g.add(a, auth('accessTo'), doc, acl)
        g.add(a, auth('agentClass'), ns.foaf('Agent'), acl);
        g.add(a, auth('mode'), auth('Read'), acl);
        if (allWrite) {
            g.add(a, auth('mode'), auth('Write'), acl);
        }
        return $rdf.serialize(acl, g, aclURI, 'text/turtle');
    }
    
    var setACL = function(docURI, allWrite, callback) {
        var aclDoc = kb.any(kb.sym(docURI),
            kb.sym('http://www.iana.org/assignments/link-relations/acl')); // @@ check that this get set by web.js
        if (aclDoc) { // Great we already know where it is
            var aclText = genACLtext(docURI, aclDoc.uri, allWrite);
            webOperation('PUT', aclDoc.uri, { data: aclText, contentType: 'text/turtle'}, callback);        
        } else {
        
            fetcher.nowOrWhenFetched(docURI, undefined, function(ok, body){
                if (!ok) return callback(ok, "Gettting headers for ACL: " + body);
                var aclDoc = kb.any(kb.sym(docURI),
                    kb.sym('http://www.iana.org/assignments/link-relations/acl')); // @@ check that this get set by web.js
                if (!aclDoc) {
                    // complainIfBad(false, "No Link rel=ACL header for " + docURI);
                    callback(false, "No Link rel=ACL header for " + docURI);
                } else {
                    var aclText = genACLtext(docURI, aclDoc.uri, allWrite);
                    webOperation('PUT', aclDoc.uri, { data: aclText, contentType: 'text/turtle'}, callback);
                }
            })
        }
    };
              

    ////////////////////////////////////// Getting logged in with a WebId
    
    var setUser = function(webid) {
        if (webid) {
            tabulator.preferences.set('me', webid);
            console.log("(SetUser: Logged in as "+ webid+")")
            me = kb.sym(webid);
            // @@ Here enable all kinds of stuff
        } else {
            tabulator.preferences.set('me', '');
            console.log("(SetUser: Logged out)")
            me = null;
        }
        if (logInOutButton) { 
            logInOutButton.refresh();  
        }
        if (webid && waitingForLogin) {
            waitingForLogin = false;
            showAppropriateDisplay();
        }
    }


    ////////// Who am I

    var whoAmI = function() {
        var me_uri = tabulator.preferences.get('me');
        me = me_uri? kb.sym(me_uri) : null;
        tabulator.panes.utils.checkUser(detailsDoc, setUser);
            
        if (!tabulator.preferences.get('me')) {
            console.log("(You do not have your Web Id set. Sign in or sign up to make changes.)");

            if (tabulator.mode == 'webapp' && typeof document !== 'undefined' &&
                document.location &&  ('' + document.location).slice(0,16) === 'http://localhost') {
             
                me = kb.any(subject, tabulator.ns.dc('author')); // when testing on plane with no webid
                console.log("Assuming user is " + me)   
            }

        } else {
            me = kb.sym(tabulator.preferences.get('me'))
            // console.log("(Your webid is "+ tabulator.preferences.get('me')+")");
        };
    }




    ////////////////////////////////  Reproduction: spawn a new instance
    //
    // Viral growth path: user of app decides to make another instance
    //

    var newInstanceButton = function() {
        return tabulator.panes.utils.newAppInstance(dom, "Start another pad",
                    initializeNewInstanceInWorkspace);
    }; // newInstanceButton




    /////////////////////////  Create new document files for new instance of app

    var initializeNewInstanceInWorkspace = function(ws) {
        var newBase = kb.any(ws, ns.space('uriPrefix')).value;
        if (!newBase) {
            newBase = ws.uri.split('#')[0];
        }
        if (newBase.slice(-1) !== '/') {
            $rdf.log.error(appPathSegment + ": No / at end of uriPrefix " + newBase ); // @@ paramater?
            newBase = newBase + '/';
        }
        var now = new Date();
        newBase += appPathSegment + '/id'+ now.getTime() + '/'; // unique id 
        
        initializeNewInstanceAtBase(thisInstance, newBase);
    }

    var initializeNewInstanceAtBase = function(thisInstance, newBase) {

        var here = $rdf.sym(thisInstance.uri.split('#')[0]);

        var sp = tabulator.ns.space;
        var kb = tabulator.kb;
        
        
        newDetailsDoc = kb.sym(newBase + 'details.ttl');
        newpadDoc = kb.sym(newBase + 'results.ttl');
        newIndexDoc = kb.sym(newBase + 'index.html');

        toBeCopied = [
            { local: 'index.html', contentType: 'text/html'} ,
            { local: 'forms.ttl', contentType: 'text/turtle'} 
//            { local: 'schedule.js', contentType: 'application/javascript'} ,
//            { local: 'mashlib.js', contentType: 'application/javascript'} , //  @@ centrialize after testing?
        ];
        
        newInstance = kb.sym(newDetailsDoc.uri + '#pad');
        kb.add(newInstance, ns.rdf('type'), PAD('Noitepad'), newDetailsDoc);
        if (me) {
            kb.add(newInstance, DC('author'), me, newDetailsDoc);
        }
        
        kb.add(newInstance, DC('created'), new Date(), newDetailsDoc);
        kb.add(newInstance, SCHED('padDocument'), newDetailsDoc);
        
        // Keep a paper trail   @@ Revisit when we have non-public ones @@ Privacy
        kb.add(newInstance, tabulator.ns.space('inspiration'), thisInstance, detailsDoc);            
        kb.add(newInstance, tabulator.ns.space('inspiration'), thisInstance, newDetailsDoc);
        
        // $rdf.log.debug("\n Ready to put " + kb.statementsMatching(undefined, undefined, undefined, there)); //@@


        agenda = [];
        agenda.push(function createDetailsFile(){
            updater.put(
                newDetailsDoc,
                kb.statementsMatching(undefined, undefined, undefined, newDetailsDoc),
                'text/turtle',
                function(uri2, ok, message) {
                    if (ok) {
                        agenda.shift()();
                    } else {
                        complainIfBad(ok, "FAILED to save new notepad at: "+ there.uri +' : ' + message);
                        console.log("FAILED to save new notepad at: "+ there.uri +' : ' + message);
                    };
                }
            );
        });

        var f, fi, fn; //   @@ This needs some form of visible progress bar
        for (f=0; f < toBeCopied.length; f++) {
            var item = toBeCopied[f];
            var fun = function copyItem(item) {
                agenda.push(function(){
                    var newURI = newBase + item.local;
                    console.log("Copying " + base + item.local + " to " +  newURI);
                    webCopy(base + item.local, newBase + item.local, item.contentType, function(uri, ok, message, xhr) {
                        if (!ok) {
                            complainIfBad(ok, "FAILED to copy "+ base + item.local +' : ' + message);
                            console.log("FAILED to copy "+ base + item.local +' : ' + message);
                        } else {
                            xhr.resource = kb.sym(newURI);
                            kb.fetcher.parseLinkHeader(xhr, kb.bnode()); // Dont save the whole headers, just the links
                            setACL(newURI, false, function(ok, message){
                                if (!ok) {
                                    complainIfBad(ok, "FAILED to set ACL "+ newURI +' : ' + message);
                                    console.log("FAILED to set ACL "+ newURI +' : ' + message);
                                } else {
                                    agenda.shift()(); // beware too much nesting
                                }
                            })
                        }
                    });
                });
            };
            fun(item);
        };
        
            
        agenda.push(function() {
            webOperation('PUT', newpadDoc.uri, { data: "", contentType: 'text/turtle'}, function(ok, body) {
                complainIfBad(ok, "Failed to initialize empty results file: " + body);
                if (ok) agenda.shift()();
            })
        });

        agenda.push(function() {
            setACL(newpadDoc.uri, true, function(ok, body) {
                complainIfBad(ok, "Failed to set Read-Write ACL on results file: " + body);
                if (ok) agenda.shift()();
            })
        });

        agenda.push(function() {
            setACL(newDetailsDoc.uri, false, function(ok, body) {
                complainIfBad(ok, "Failed to set read ACL on configuration file: " + body);
                if (ok) agenda.shift()();
            })
        });

        agenda.push(function(){  // give the user links to the new app
        
            var p = div.appendChild(dom.createElement('p'));
            p.setAttribute('style', 'font-size: 140%;') 
            p.innerHTML = 
                "Your <a href='" + newIndexDoc.uri + "'><b>new notepad</b></a> is ready to be set up. "+
                "<br/><br/><a href='" + newIndexDoc.uri + "'>Say when you what days work for you.</a>";
            });
        
        agenda.shift()();        
        // Created new data files.
    }

    ///////////////  Update on incoming changes
    



    // Reload resorce then
    
    var reloadDocument = function(doc, callBack) {
        console.log("Unloading " + tabulator.kb.statementsMatching(undefined, undefined, undefined, doc).length
            + " out of " + tabulator.kb.statements.length)
        tabulator.fetcher.unload(doc);
        tabulator.fetcher.nowOrWhenFetched(doc.uri, {force: true}, function(ok, body){
            if (!ok) {
                callback(false, "Error reloading pad data: "+body)
                console.log("Cant refresh data:" + body);
            } else {
                console.log("Reloaded " + tabulator.kb.statementsMatching(undefined, undefined, undefined, doc).length
                    + " out of " + tabulator.kb.statements.length)
                callBack(true);
            };
        });
    };



    // Refresh the DOM tree
  
    var refreshTree = function(root) {
        if (root.refresh) {
            root.refresh();
            return;
        }
        for (var i=0; i < root.children.length; i++) {
            refreshTree(root.children[i]);
        }
    }






    ////////////////////////////////////////////////
    
    //   The pad widget
    
    
    
    
    tabulator.panes.utils.notepad  = function (dom, subject, options) {
        options = options || {}
        var exists = options.exists;
        var table = dom.createElement('table');
        var kb = tabulator.kb;
        // var mainRow = table.appendChild(dom.createElement('tr'));
        
        var currentNode, currentOffset;
        
        var setPartStyle = function(part, colors) {
            var chunk = part.subject;
            var baseStyle = 'font-size: 100%; font-family: monospace; min-width: 50em; border: none;'; //  font-weight:
            var headingCore = 'font-family: sans-serif; font-weight: bold;  border: none;'
            var headingStyle = [ 'font-size: 110%;  padding-top: 0.5em; padding-bottom: 0.5em;min-width: 20em;' ,
                'font-size: 120%; padding-top: 1em; padding-bottom: 1em; min-width: 20em;' ,
                'font-size: 150%; padding-top: 1em; padding-bottom: 1em; min-width: 20em;' ];

            var author = kb.any(chunk, ns.dc('author'));
            if (!colors && author) { // Hash the user webid for now -- later allow user selection!
                var hash = function(x){return x.split("").reduce(function(a,b){a=((a<<5)-a)+b.charCodeAt(0);return a&a},0); }
                var bgcolor = '#' + ((hash(author.uri) & 0xffffff) | 0xc0c0c0).toString(16); // c0c0c0 or 808080 forces pale
                colors = 'color: black; background-color: ' + bgcolor + ';'
            }

            var indent = kb.any(chunk, PAD('indent'));
            
            indent = indent ? indent.value : 0;
            var style =  (indent >= 0) ?
                baseStyle + 'padding-left: ' + (indent * 3) + 'em;'
                :   headingCore + headingStyle[ -1 - indent ]; 
            part.setAttribute('style', style + colors);
        }
        

        var removePart = function(part) {
            var chunk = part.subject;
            var prev = kb.any(undefined, PAD('next'), chunk);
            var next = kb.any(chunk, PAD('next'));
            if (prev.sameTerm(subject) && next.sameTerm(subject)) { // Last one
                console.log("You can't delete the last line.")
                return;
            }
            var del = kb.statementsMatching(chunk, undefined, undefined, padDoc)
                    .concat(kb.statementsMatching(undefined, undefined, chunk, padDoc));
            var ins = [ $rdf.st(prev, PAD('next'), next, padDoc) ];

           tabulator.sparql.update(del, ins, function(uri,ok,error_body){
                if (!ok) {
                    //alert("Fail to removePart " + error_body);
                    console.log("removePart FAILED " + chunk + ": " + error_body);
                    console.log("removePart was deleteing :'" + del);
                    setPartStyle(part, 'color: black;  background-color: #fdd;');// failed
                    tabulator.sparql.requestDownstreamAction(reloadAndSync);
                } else {
                    var row = part.parentNode;
                    var before = row.previousSibling;
                    row.parentNode.removeChild(row);
                    console.log("delete row ok " + part.value);
                    if (before && before.firstChild) {
                        before.firstChild.focus();
                    }
                }
            });
        }
        
        var changeIndent = function(part, chunk, delta) {
            var del = kb.statementsMatching(chunk, PAD('indent'));
            var current =  del.length? Number(del[0].object.value) : 0;
            if (current + delta < -3) return; //  limit negative indent
            var newIndent = current + delta;
            var ins = $rdf.st(chunk, PAD('indent'), newIndent, padDoc);
            tabulator.sparql.update(del, ins, function(uri, ok, error_body){
                if (!ok) {
                    console.log("Indent change FAILED '" + newIndent + "' for "+padDoc+": " + error_body);
                    setPartStyle(part, 'color: black;  background-color: #fdd;'); // failed
                    tabulator.sparql.requestDownstreamAction(reloadAndSync);
                } else {
                    setPartStyle(part); // Implement the indent
                }
            });
        }
        
        var addListeners = function(part, chunk) {

            part.addEventListener('keydown', function(event){
                var author = kb.any(chunk, ns.dc('author')); 
                //  up 38; down 40; left 37; right 39     tab 9; shift 16; escape 27
                switch(event.keyCode) {
                case 13:                    // Return
                    console.log("enter");
                    newChunk(document.activeElement);
                    break;
                case 8: // Delete
                    if (part.value.length === 0 ) {
                        console.log("Deleting line")
                        removePart(part);
                    }
                    break;
                case 9: // Tab
                    var delta = event.shiftKey ? -1 : 1;
                    changeIndent(part, chunk, delta);
                    event.preventDefault(); // default is to highlight next field
                    break;
                case 27:  // ESC
                    tabulator.sparql.requestDownstreamAction(reloadAndSync);
                    break;
                    
                case 38: // Up
                    if (part.parentNode.previousSibling) {
                        part.parentNode.previousSibling.firstChild.focus();
                        event.preventDefault();
                    }

                case 40: // Down
                    if (part.parentNode.nextSibling) {
                        part.parentNode.nextSibling.firstChildfocus();
                        event.preventDefault();
                    }

                default:
                }
            });

            part.addEventListener('click', function(event){
                //var chunk = event.target.subject;
                var author = kb.any(chunk, ns.dc('author'));

                var range;
                var textNode;
                var offset;

                if (document.caretPositionFromPoint) {
                    range = document.caretPositionFromPoint(event.clientX, event.clientY);
                    textNode = range.offsetNode;
                    offset = range.offset;
                } else if (document.caretRangeFromPoint) {
                    range = document.caretRangeFromPoint(event.clientX, event.clientY);
                    textNode = range.startContainer;
                    offset = range.startOffset;
                }

                if (me.sameTerm(author)) {
                    // continue to edit
     
                    // only split TEXT_NODEs
                    if (textNode.nodeType == 3) {
                        textNode.textContent = textNode.textContent.slice(0,offset) 
                        + '#' + textNode.textContent.slice(offset); 
                        currentNode = textNode;
                        currentOffset = offset;
                    }
                
                } else {
                    // @@ where is the cursor?
                    // https://developer.mozilla.org/en-US/docs/Web/API/Document/caretPositionFromPoint
                    // https://drafts.csswg.org/cssom-view/#the-caretposition-interface
                    
                    
                    // only split TEXT_NODEs
                    if (textNode.nodeType == 3) {
                    
                        var replacement = textNode.splitText(offset);
                        
                        var bling = document.createElement('span');
                        bling.textContent = "*"; // @@
                        
                        textNode.parentNode.insertBefore(bling, replacement);
                    }
                }
            });

            var updateStore = function(part) {
                var chunk = part.subject;
                setPartStyle(part, 'color: #888;');
                var old = kb.any(chunk, ns.sioc('content')).value;
                del = [ $rdf.st(chunk, ns.sioc('content'), old, padDoc)];
                ins = [ $rdf.st(chunk, ns.sioc('content'), part.value, padDoc)];
                
                tabulator.sparql.update(del, ins, function(uri,ok,error_body){
                    if (!ok) {
                        // alert("clash " + error_body);
                        console.log("patch FAILED '" + part.value + "' " + error_body);
                        setPartStyle(part,'color: black;  background-color: #fdd;'); // failed
                        part.state = 0;
                        tabulator.sparql.requestDownstreamAction(reloadAndSync);
                    } else {
                        setPartStyle(part); // synced
                        // console.log("patch ok " + part.value);
                        if (part.state === 2) {
                            part.state = 1;  // pending: lock
                            updateStore(part)
                        } else {
                            part.state = 0; // clear lock
                        }
                    }
                });
            }

            part.addEventListener('input', function inputChangeListener(event) {
                // console.log("input changed "+part.value);
                setPartStyle(part, 'color: #888;'); // grey out - not synced
                if (part.state) {
                    part.state = 2; // please do again
                    return;
                } else {
                    part.state = 1; // in progres
                }
                updateStore(part);

            }); // listener
            
        } // addlisteners

 
        var newPartBefore = function(tr1, chunk) { // @@ take chunk and add listeners
            text = kb.any(chunk, ns.sioc('content'));
            text = text ? text.value : '';
            var tr = dom.createElement('tr');
            if (tr1 && tr1.nextSibling) {
                table.insertBefore(tr, tr1.nextSibling);
            } else {
                table.appendChild(tr);
            }
            var part = tr.appendChild(dom.createElement('input'));
            part.subject = chunk;
            part.setAttribute('type', 'text')
            setPartStyle(part, '');
            part.value = text;
            addListeners(part, chunk);
            return part
        };

        
               
        var newChunk = function(ele) { // element of chunk being split
            var kb = tabulator.kb, tr1;

            var here, next, indent = 0;
            if (ele) {
                if (ele.tagName.toLowerCase() !== 'input') {
                    console.log('return pressed when current document is: ' + ele.tagName)
                }
                here = ele.subject;
                indent = kb.any(here, PAD('indent'));
                indent = indent? Number(indent.value)  : 0;
                next =  kb.any(here, PAD('next'));
                tr1 = ele.parentNode;
            } else {
                here = subject
                next = subject;
                tr1 = undefined;
            }

            var chunk = tabulator.panes.utils.newThing(padDoc);
            var part = newPartBefore(tr1, chunk);

            del = [ $rdf.st(here, PAD('next'), next, padDoc)];
            ins = [ $rdf.st(here, PAD('next'), chunk, padDoc),
                    $rdf.st(chunk, PAD('next'), next, padDoc),
                    $rdf.st(chunk, ns.dc('author'), me, padDoc),
                    $rdf.st(chunk, ns.sioc('content'), '', padDoc)];
            if (indent > 0) { // Do not inherit 
                ins.push($rdf.st(chunk, PAD('indent'), indent, padDoc));
            }

            tabulator.sparql.update(del, ins, function(uri,ok,error_body){
                if (!ok) {
                    alert("Error writing fresh PAD data " + error_body)
                } else {
                    console.log("fresh chunk updated");
                    setPartStyle(part);
                }
            });
            
            part.focus();
           
        }//



        // Ensure that the display matches the current state of the
        var sync = function() {
            var first = kb.the(subject, PAD('next'));
            if (kb.each(subject, PAD('next')).length !== 1) {
                console.log("Pad: Inconsistent data - too many NEXT pointers: "
                    + (kb.each(subject, PAD('next')).length));
                //alert("Inconsitent data");
                return
            }
            var last = kb.the(undefined, PAD('previous'), subject);
            var chunk = first; //  = kb.the(subject, PAD('next'));
            var row = table.firstChild;
                
                // First see which of the logical chunks have existing physical manifestations
                
            manif = [];
            // Find which lines correspond to existing chunks
            for (chunk = kb.the(subject, PAD('next'));  
                !chunk.sameTerm(subject);
                chunk = kb.the(chunk, PAD('next'))) {
                for (var i=0; i< table.children.length; i++) {
                    var tr = table.children[i];
                    if (tr.firstChild.subject.sameTerm(chunk)) {
                        manif[chunk.uri] = tr.firstChild;
                    }
                }
            }
            
            // Remove any deleted lines
            for (var i = table.children.length -1; i >= 0 ; i--) {
                var row = table.children[i];
                if (!manif[row.firstChild.subject.uri]) {
                    table.removeChild(row);
                }
            }
            // Insert any new lines
            row = table.firstChild;
            for (chunk = kb.the(subject, PAD('next'));  
                !chunk.sameTerm(subject);
                chunk = kb.the(chunk, PAD('next'))) {
                var text = kb.any(chunk, ns.sioc('content')).value;
                // superstitious -- don't mess with unchanged input fields
                // which may be selected by the user
                if (manif[chunk.uri]) { 
                    if (text !== row.firstChild.value) {
                        row.firstChild.value = text;
                    }
                    row.firstChild.state = 0;
                    row = row.nextSibling
                } else {
                    newPartBefore(row, chunk);
                }
            };
        };
        
        var reloadAndSync = function() {
            console.log("RELOADING TO SYNC ENTIRE FILE");
            reloadDocument(padDoc, function(ok) {
                console.log("SYNC ENTIRE FILE");
                refreshTree(table);
            });
        }
        
        table.refresh = sync; // Catch downward propagating refresh events
        
        if (exists) {
            console.log("Existing pad.");
            sync()
        } else { // Make new pad
            console.log("No pad exists - making new one.");

            var insertables = [];
            insertables.push($rdf.st(subject, ns.dc('author'), me, padDoc));
            insertables.push($rdf.st(subject, ns.dc('created'), new Date(), padDoc));
            insertables.push($rdf.st(subject, PAD('next'), subject, padDoc));
            
            tabulator.sparql.update([], insertables, function(uri,ok,error_body){
                if (!ok) {
                    complainIfBad(ok, error_body);
                } else {
                    console.log("Initial pad created");
                    newChunk(); // Add a first chunck
                    // getResults();
                }
            });
        }
        return table;
    }
    
    /////////////////////////

   
    var getDetails = function() {
        console.log("getDetails()"); // Looking for blank screen hang-up
        fetcher.nowOrWhenFetched(detailsDoc.uri, undefined, function(ok, body){
            console.log("getDetails() ok? " + ok);
            if (!ok) return complainIfBad(ok, body);
            getResults();
        });
    };
    
    var listenToIframe = function() {
        // Event listener for login (from child iframe)
        var eventMethod = window.addEventListener ? "addEventListener" : "attachEvent";
        var eventListener = window[eventMethod];
        var messageEvent = eventMethod == "attachEvent" ? "onmessage" : "message";

        // Listen to message from child window
        eventListener(messageEvent,function(e) {
          if (e.data.slice(0,5) == 'User:') {
            // the URI of the user (currently either http* or dns:* values)
            var user = e.data.slice(5, e.data.length);
            if (user.slice(0, 4) == 'http') {
              // we have an HTTP URI (probably a WebID), do something with the user variable
              // i.e. app.login(user);
                setUser(user);
            }
          }
        },false);    
    }
    
    var showResults = function(exists) {
        console.log("showResults()");
        
        whoAmI(); // Set me  even if on a plane
        
        var padEle = (tabulator.panes.utils.notepad(dom, subject, { exists: exists }));
        naviMain.appendChild(padEle);
        
        // Listen for chanes to the pad and update it
        var wssURI = getUpdatesVia(padDoc); // relative

        //var sockURI = getChangesURI(padDoc, 'changes'); // Live updates 2
        if (!wssURI) {
            console.log("Server doies not support live updates thoughUpdates-Via :-(")
        } else {
            wssURI = $rdf.uri.join(wssURI, padDoc.uri); 
            wssURI = wssURI.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
            console.log("Web socket URI " + wssURI);
            
            // From https://github.com/solid/solid-spec#live-updates
            var socket = new WebSocket(wssURI);
            socket.onopen = function() {
                this.send('sub ' + padDoc.uri);
            };
            socket.onmessage = function(msg) {
                if (msg.data && msg.data.slice(0, 3) === 'pub') {
                
                    reloadDocument(padDoc, function(ok) {
                        refreshTree(padEle);
                    });
                }
            };
        }
    };
    
    var showSignon = function showSignon() {
        var d = clearElement(naviMain);
        // var d = div.appendChild(dom.createElement('div'));
        var origin =  window && window.location ? window.location.origin : '';
        d.innerHTML = '<p style="font-size: 120%; background-color: #ffe; padding: 2em; margin: 1em; border-radius: 1em;">'+
        'You need to be logged in.<br />To be able to use this app'+
            ' you need to log in with webid account at a storage provider.</p> '+
            '<iframe class="text-center" src="https://linkeddata.github.io/signup/?ref=' + origin + '" '+
            'style="margin-left: 1em; margin-right: 1em; width: 95%; height: 40em;" '+
            ' sandbox="allow-same-origin allow-scripts allow-forms" frameborder="0"></iframe>';
            listenToIframe();
            waitingForLogin = true; // hack
    };
    
    var showBootstrap = function showBootstrap() {
        var div = clearElement(naviMain);
        var na = div.appendChild(tabulator.panes.utils.newAppInstance(
            dom, "Start a new poll in a workspace", initializeNewInstanceInWorkspace));
        
        var hr = div.appendChild(dom.createElement('hr')); // @@
        
        var p = div.appendChild(dom.createElement('p'));
        p.textContent = "Where would you like to store the data for the poll?  " +
        "Give the URL of the directory where you would like the data stored.";
        var baseField = div.appendChild(dom.createElement('input'));
        baseField.setAttribute("type", "text");
        baseField.size = 80; // really a string
        baseField.label = "base URL";
        baseField.autocomplete = "on";

        div.appendChild(dom.createElement('br')); // @@
        
        var button = div.appendChild(dom.createElement('button'));
        button.textContent = "Start new poll at this URI";
        button.addEventListener('click', function(e){
            var newBase = baseField.value;
            if (newBase.slice(-1) !== '/') {
                newBase += '/';
            }
            initializeNewInstanceAtBase(thisInstance, newBase);
        });
    } 
          
    /////////////// The forms to configure the pad
    
    var showForms = function() {

        var div = naviMain;
        var wizard = true;
        var currentSlide = 0;
        var gotDoneButton = false;
        if (wizard) {
        
            forms = [ form1, form2, form3 ];
            slides = [];
            var slide, currentSlide = 0;
            for (var f=0; f<forms.length; f++) {
                slide = dom.createElement('div');
                tabulator.panes.utils.appendForm(document, slide, {}, subject, forms[f], detailsDoc, complainIfBad);
                slides.push(slide);
            }

            var refresh = function() {
                clearElement(naviMain).appendChild(slides[currentSlide]);
                
                if (currentSlide === 0) {
                    b1.setAttribute('disabled', '');
                } else {
                    b1.removeAttribute('disabled');
                }
                if (currentSlide === slides.length - 1 ) {
                    b2.setAttribute('disabled', '');
                    if (!gotDoneButton) { // Only expose at last slide seen
                        naviCenter.appendChild(doneButton); // could also check data shape
                        gotDoneButton = true;
                    }
                } else {
                    b2.removeAttribute('disabled');
                }
                
            }
            var b1 = clearElement(naviLeft).appendChild(dom.createElement('button'));
            b1.textContent = "<- go back";
            b1.addEventListener('click', function(e) {
                if (currentSlide > 0) {
                    currentSlide -= 1;
                    refresh();
                } 
            }, false);

            
            var b2 = clearElement(naviRight).appendChild(dom.createElement('button'));
            b2.textContent = "continue ->";
            b2.addEventListener('click', function(e) {
                if (currentSlide < slides.length - 1) {
                    currentSlide += 1;
                    refresh();
                } 
            }, false);

            refresh();
            
        } else { // not wizard one big form
            // @@@ create the initial config doc if not exist
            var table = div.appendChild(dom.createElement('table'));
            tabulator.panes.utils.appendForm(document, table, {}, subject, form1, detailsDoc, complainIfBad);
            tabulator.panes.utils.appendForm(document, table, {}, subject, form2, detailsDoc, complainIfBad);
            tabulator.panes.utils.appendForm(document, table, {}, subject, form3, detailsDoc, complainIfBad);
            naviCenter.appendChild(doneButton); // could also check data shape
           
        }
        // @@@  link config to results
        
        insertables = [];
        insertables.push($rdf.st(subject, SCHED('availabilityOptions'), SCHED('YesNoMaybe'), detailsDoc));
        insertables.push($rdf.st(subject, SCHED('ready'), new Date(), detailsDoc));
        insertables.push($rdf.st(subject, SCHED('results'), padDoc, detailsDoc)); // @@ also link in results
        



        var doneButton = dom.createElement('button');
        doneButton.textContent = "Done";
        doneButton.addEventListener('click', function(e) {
            if (kb.any(subject, SCHED('ready'))) { // already done
                getResults();
            } else {
                tabulator.sparql.update([], insertables, function(uri,ok,error_body){
                    if (!ok) {
                        complainIfBad(ok, error_body);
                    } else {
                        getResults();
                    }
                });
            }
        }, false);
        
    } // showForms
    
   
 
    // Read or create empty results file
    
    var getResults = function () {
        var div = naviMain;
        fetcher.nowOrWhenFetched(padDoc.uri, undefined, function(ok, body, xhr){
            if (!ok) {   
                if (0 + xhr.status === 404) { ///  Check explictly for 404 error
                    console.log("Initializing results file " + padDoc)
                    updater.put(padDoc, [], 'text/turtle', function(uri2, ok, message, xhr) {
                        if (ok) {
                            kb.fetcher.saveRequestMetadata(xhr, kb, padDoc.uri);
                            kb.fetcher.saveResponseMetadata(xhr, kb); // Drives the isEditable question
                            clearElement(naviMain);
                            showResults(false);
                        } else {
                            complainIfBad(ok, "FAILED to create results file at: "+ padDoc.uri +' : ' + message);
                            console.log("FAILED to craete results file at: "+ padDoc.uri +' : ' + message);
                        };
                    });
                } else { // Other error, not 404 -- do not try to overwite the file
                    complainIfBad(ok, "FAILED to read results file: " + body)
                }
            } else { // Happy read
                clearElement(naviMain);
                showResults(true);
            }
        });
    };
        
    ////////////////////////////////////////////// Body of App (on loaded lstner)
    
    //  Build the DOM
    
    var structure = div.appendChild(dom.createElement('table')); // @@ make responsive style
    structure.setAttribute('style', 'background-color: white; min-width: 40em; min-height: 13em;');
    
    var naviLoginoutTR = structure.appendChild(dom.createElement('tr'));
    var naviLoginout1 = naviLoginoutTR.appendChild(dom.createElement('td'));
    var naviLoginout2 = naviLoginoutTR.appendChild(dom.createElement('td'));
    var naviLoginout3 = naviLoginoutTR.appendChild(dom.createElement('td'));
    
    var logInOutButton = null;

    var naviTop = structure.appendChild(dom.createElement('tr'));
    var naviMain = naviTop.appendChild(dom.createElement('td'));
    naviMain.setAttribute('colspan', '3');

    var naviMenu = structure.appendChild(dom.createElement('tr'));
    naviMenu.setAttribute('class', 'naviMenu');
//    naviMenu.setAttribute('style', 'margin-top: 3em;');
    var naviLeft = naviMenu.appendChild(dom.createElement('td'));
    var naviCenter = naviMenu.appendChild(dom.createElement('td'));
    var naviRight = naviMenu.appendChild(dom.createElement('td'));
    

    getDetails();

});


