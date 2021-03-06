/* <![CDATA[ */
if (typeof(webpg)=='undefined') { webpg = {}; }
// Enforce jQuery.noConflict if not already performed
if (typeof(jQuery)!='undefined') { webpg.jq = jQuery.noConflict(true); }

/*
    This file is loaded with each new page request and handles setting up
    the required structure(s) for parsing/modifying page content.
*/

/*
   Class: webpg.overlay
    This class implements the overlay/content-script for the extension.
    It is loaded with each new page request and handles setting up
    the required structure(s) for parsing/modifying page content.
*/
webpg.overlay = {

    /*
        Function: init
            This function is called when a new window is created. It sets the preferences
            and calls the parsing functions.

        Parameters:
            aEvent - <event> The window event
    */
    init: function(aEvent) {
        webpg.doc = (aEvent) ?
            aEvent.originalTarget : document;

        // We don't want to run on certain pages
        //  TODO: consult a list of user defined domains/pages to ignore
        webpg.overlay.blackListedDomains = ["twitter.com", "translate.google.com"];
        var proceed = webpg.overlay.blackListedDomains.every(function(bldomain) {
            console.log(webpg.doc.location.host.indexOf(bldomain));
            return (webpg.doc.location.host.indexOf(bldomain) == -1);
        });

        if (!proceed)
            return false;

        if (webpg.utils.detectedBrowser['vendor'] == 'google') {
            webpg.overlay.insert_target = null;
            webpg.overlay.insert_range = null;
            webpg.overlay.block_target = null;
        }

        function hideContextmenu(e){
            webpg.overlay.isContextMenuOpen = false;
        }

        webpg.overlay.isContextMenuOpen = false;
        webpg.jq(document).blur(hideContextmenu);
        webpg.jq(document).click(hideContextmenu);


        document.addEventListener("contextmenu", webpg.overlay.contextHandler, true);

        // Setup a listener for making changes to the page
        webpg.utils._onRequest.addListener(webpg.overlay._onRequest);

        // Check if inline formatting is enabled and setup
        //  required parsers
        webpg.utils.sendRequest({
            'msg': "decorate_inline" },
            function(response) {
                if (response.result.decorate_inline == "true") {
                    var mode = response.result.mode;
                    if (webpg.utils.detectedBrowser['vendor'] == "mozilla") {
                        if (!webpg.plugin) {
                            var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                                   .getService(Components.interfaces.nsIWindowMediator);
                            var winType = (webpg.utils.detectedBrowser['product'] == "thunderbird") ?
                                "mail:3pane" : "navigator:browser";
                            var browserWindow = wm.getMostRecentWindow(winType);
                            webpg.plugin = browserWindow.webpg.plugin;
                        }

                        // Begin parsing the document for PGP Data
                        webpg.inline.init(webpg.doc, mode);
                    } else if (webpg.utils.detectedBrowser['product'] == "chrome") {
                        webpg.inline.init(document, mode);
                    }
                }
            }
        );
    },


    /*
        Function: _onRequest
            Provides the document listeners for receiving events

        Parameters:
            request - <obj> The request object
            sender  - <obj> The sender (tab/page) of the request
            sendResponse - <func> The function to execute with the
                response as the parameter
    */
    _onRequest: function(request, sender, sendResponse) {
        var _ = webpg.utils.i18n.gettext;
        var response = null;

        if (request.msg == "log") {
            console.log("Remote log request recieved; ", request.data);
        }

        if (request.msg == "resizeiframe"
        || (request.msg == "sendtoiframe"
        && webpg.utils.detectedBrowser['vendor'] == 'mozilla')) {

            var iframe = webpg.utils.getFrameById(request.iframe_id)
            if (iframe) {
                if (request.width)
                    iframe.style.width = width + "px";
                var height = request.height;
                iframe.height = height + "px";
            }
            if (request.scrollTop) {
                if (iframe) {
                    iframe.scrollIntoView();
                    if (webpg.utils.detectedBrowser['vendor'] == 'mozilla'
                    && iframe.contentWindow.parent !== content) {
                        iframe.ownerDocument.body.scrollIntoView();
                    }
                }
            }
        } else if (request.msg == "removeiframe") {
            if (request.dialog_type && request.dialog_type == "editor") {
                webpg.overlay.prior_insert_target = null;
            }
            if (request.iframe_id) {
                try {
                    var doc = (webpg.utils.detectedBrowser['vendor'] == 'mozilla') ? content.document :
                        document;
                    var iframe = webpg.jq("#" + request.iframe_id, [doc, document]);
                    if (iframe.length < 1)
                        iframe = webpg.jq(webpg.overlay.insert_target.ownerDocument).find("#" + request.iframe_id);
                    webpg.jq(iframe).remove();
                    webpg.overlay.block_target = false;
                } catch (err) {
                    webpg.jq(iframe).hide();
                }
            }
        } else if (request.msg == "insertEncryptedData") {
            var doc = (webpg.utils.detectedBrowser['vendor'] == "mozilla") ? content.document : document;

            if (webpg.overlay.prior_insert_target != null)
                return false;

            if (webpg.overlay.insert_target != null && request.data) {
                if (webpg.overlay.insert_range != null
                && (webpg.overlay.insert_target.nodeName != "TEXTAREA"
                && webpg.overlay.insert_target.nodeName != "INPUT")) {
                    var contents = webpg.overlay.insert_range.extractContents();
                    contents.textContent = request.data;
                    webpg.overlay.insert_target.style.whiteSpace = "pre";
                    webpg.overlay.insert_range.insertNode(contents);
                } else {
                    var target_value = request.pre_selection +
                        request.data +
                        request.post_selection;
                    if (webpg.overlay.insert_target.nodeName == "TEXTAREA" ||
                        webpg.overlay.insert_target.nodeName == "INPUT") {
                        webpg.jq(webpg.overlay.insert_target).val(target_value);
                    } else {
                        webpg.overlay.insert_target.style.whiteSpace = "pre";
                        webpg.overlay.insert_target.textContent = target_value;
                    }
                }
            }
            if (request.iframe_id) {
                webpg.overlay._onRequest({"msg": "removeiframe",
                    "iframe_id": request.iframe_id});
            }
            if (webpg.overlay.insert_target
            && typeof(webpg.overlay.insert_target.updateElementValue) != 'undefined') {
                webpg.overlay.insert_target.updateElementValue(webpg.overlay.insert_target);
            }
            webpg.overlay.block_target = false;
        } else if (request.msg == "insertPublicKey") {
            if (webpg.overlay.insert_target != null) {
                webpg.jq(webpg.overlay.insert_target).val(request.data);
            }
            if (request.iframe_id) {
                webpg.overlay._onRequest({"msg": "removeiframe",
                    "iframe_id": request.iframe_id});
            }
            if (webpg.overlay.insert_target
            && typeof(webpg.overlay.insert_target.updateElementValue) != 'undefined') {
                webpg.overlay.insert_target.updateElementValue(webpg.overlay.insert_target);
            }
            webpg.overlay.block_target = false;
        } else if (request.msg == "insertSignedData") {
            if (webpg.overlay.insert_range != null
            && (webpg.overlay.insert_target.nodeName != "TEXTAREA"
            && webpg.overlay.insert_target.nodeName != "INPUT")) {
                var contents = webpg.overlay.insert_range.extractContents();
                contents.textContent = request.data;
                webpg.overlay.insert_target.style.whiteSpace = "pre";
                webpg.overlay.insert_range.insertNode(contents);
            } else {
                console.log(request);
                var target_value = request.pre_selection +
                    request.data +
                    request.post_selection;
                if (webpg.overlay.insert_target.nodeName == "TEXTAREA" ||
                    webpg.overlay.insert_target.nodeName == "INPUT") {
                    webpg.jq(webpg.overlay.insert_target).val(target_value);
                } else {
                    webpg.overlay.insert_target.style.whiteSpace = "pre";
                    webpg.overlay.insert_target.textContent = target_value;
                }
            }
            if (webpg.overlay.insert_target
            && typeof(webpg.overlay.insert_target.updateElementValue) != 'undefined') {
                webpg.overlay.insert_target.updateElementValue(webpg.overlay.insert_target);
            }
            webpg.overlay.block_target = false;
        } else if (request.msg == "insertIntoPrior") {
            if (webpg.overlay.prior_insert_target != null) {
                webpg.jq(webpg.overlay.prior_insert_target).val(request.data);
                webpg.overlay.prior_insert_target = null;
            }
            if (webpg.overlay.insert_target
            && typeof(webpg.overlay.insert_target.updateElementValue) != 'undefined') {
                webpg.overlay.insert_target.updateElementValue(webpg.overlay.insert_target);
            }
            webpg.overlay.block_target = false;
        } else if (request.msg == "insertDecryptedData") {
            if (request.message_event == "editor") {
                if (!request.decrypt_status.error) {
                    webpg.overlay.insert_target.value = request.decrypt_status.data;
                } else {
                    webpg.overlay.insert_target.value = _("UNABLE TO DECRYPT OR VERIFY THIS MESSAGE") +
                        ": " + request.decrypt_status.error_string;
                }
            } else if (webpg.overlay.insert_target != null) {
                if (!request.decrypt_status.block_type)
                    request.decrypt_status.block_type = (request.block_type) ? request.block_type : webpg.constants.PGPBlocks.PGP_SIGNED_MSG;
                if (request.decrypt_status.error)
                    request.decrypt_status.original_text = request.original_text;
                if (!request.decrypt_status.error
                && request.decrypt_status.signatures.hasOwnProperty("0"))
                    request.decrypt_status.block_type = webpg.constants.PGPBlocks.PGP_SIGNED_MSG;
                else if (!request.decrypt_status.error)
                    request.decrypt_status.block_type = webpg.constants.PGPBlocks.PGP_ENCRYPTED;
                results_frame = webpg.inline.addResultsReplacementFrame(webpg.overlay.insert_target);
                if (!request.decrypt_status.original_text)
                    request.decrypt_status.original_text = request.original_text;
                var params = {
                    'msg': "sendtoiframe",
                    'block_type': request.decrypt_status.block_type,
                    'target_id': results_frame.id,
                    'iframe_id': results_frame.id,
                    'verify_result': request.decrypt_status,
                    'message_event': request.message_type,
                    'message_type': "encrypted_message",
                    'noninline': true
                }
                if (webpg.utils.detectedBrowser['vendor'] == "mozilla")
                    webpg.utils.sendRequest(params);
                else
                    results_frame.onload = function() {
                        webpg.utils.sendRequest(params);
                    }
            }
            if (webpg.overlay.insert_target
            && typeof(webpg.overlay.insert_target.updateElementValue) != 'undefined') {
                webpg.overlay.insert_target.updateElementValue(webpg.overlay.insert_target);
            }
            webpg.overlay.block_target = false;
        } else if (request.msg == "openDialog") {
            var target = webpg.overlay.insert_target;
            var range = webpg.overlay.insert_range;

            if (request.dialog_type == "editor")
                webpg.overlay.prior_insert_target = target;

            var theURL = webpg.utils.resourcePath + "dialog.html?dialog_type="
                + request.dialog_type;
            if (request.dialog_type == "encrypt" || request.dialog_type == "encryptsign")
                theURL += "&encrypt_data=" + escape(request.data) +
                    "&pre_selection=" + escape(request.pre_selection) +
                    "&post_selection=" + escape(request.post_selection);
            if (request.dialog_type == "import")
                theURL += "&import_data=" + escape(request.data);
            if (request.dialog_type == "editor")
                theURL += "&editor_data=" + escape(request.data);

            var win = (webpg.utils.detectedBrowser['vendor'] == 'mozilla') ? content : window;
            
            try {
                win = webpg.overlay.insert_target.ownerDocument.defaultView;
            } catch (err) {
            }

            var hOffset = (webpg.utils.detectedBrowser['vendor'] == 'mozilla') ? 160 : 60;

            if (request.dialog_type == "editor")
                var iframe = webpg.inline.addDialogFrame(theURL,
                    request.dialog_type,
                    window.innerHeight - hOffset,
                    win.innerWidth - 60
                );
            else
                var iframe = webpg.inline.addDialogFrame(theURL, request.dialog_type);

            iframe.style.marginTop = "";
            iframe.style.marginLeft = "";

            var posY = win.scrollY + (webpg.jq(iframe).innerHeight()
                    / 3);
            var posX = (win.innerWidth / 2) - 
                    (iframe.offsetWidth / 2);

            posY = win.pageYOffset;
            if (webpg.utils.detectedBrowser['vendor'] == 'mozilla') {
                posY = (window.self === window.top) ? win.pageYOffset : 0;
            }
            posY += 20;

            webpg.jq(iframe).animate({"top": posY, "left": posX}, 1);
        } else if (request.msg == "onContextCommand") {
            var event = request.source || null;
            webpg.overlay.onContextCommand(event, request.action, sender);
        }
    },

    /*
        Function: contextHandler
            The receiver for all context events

        Parameters:
            event - <evt> The context event
    */
    contextHandler: function(event) {
        context_menuitems = {};
        webpg.overlay.isContextMenuOpen = true;
        if (!webpg.overlay.block_target)
            webpg.overlay.insert_target = event.target;
        webpg.overlay.contextSelection = webpg.utils.getSelectedText();
        var selection = webpg.overlay.contextSelection.selectionText;
        block_type = selection.match(/^\s*?(-----BEGIN PGP.*)/gi);
        if (selection.length > 0 && block_type && block_type[0] ==
            webpg.constants.PGPTags.PGP_KEY_BEGIN) {
                context_menuitems['import'] = true;
        } else if (selection.length > 0 && block_type && block_type[0] ==
            webpg.constants.PGPTags.PGP_ENCRYPTED_BEGIN) {
                context_menuitems['decrypt'] = true;
        } else if (selection.length > 0 && (block_type && block_type[0] ==
            webpg.constants.PGPTags.PGP_SIGNED_MSG_BEGIN) ||
            (event.target.value && event.target.value.substr(event.target
            .selectionStart,
            webpg.constants.PGPTags.PGP_SIGNED_MSG_BEGIN.length) ==
            webpg.constants.PGPTags.PGP_SIGNED_MSG_BEGIN)) {
                context_menuitems['verify'] = true;
        } else if (selection.length > 0) {
            // text to sign or encrypt
            if (event.target.textContent.substr(0, 5) != "-----") {
                context_menuitems['sign'] = true;
                context_menuitems['encrypt'] = true;
            }
        } else if (!selection.length > 0) {
            context_menuitems['paste'] = true;
        }
        webpg.utils.sendRequest({'msg': "create_menu", "context_menuitems":
            context_menuitems});
    },

    /*
        Function: onContextCommand
            Handles context and menu requests

        Parameters:
            event - <event> The original event
            action - <str> The action to perform
            sender  - <obj> The sender (tab/page) of the request
    */
	onContextCommand: function(event, action, sender, selection) {
	    selection = selection || webpg.overlay.contextSelection;

	    switch (action) {
       		case webpg.constants.overlayActions.PSIGN:
       		    if (event == "context-menu")
       		        webpg.overlay.block_target = true;
       		    webpg.utils.sendRequest({
       		        "msg": "sign",
       		        "selectionData": selection
       		    });
                break;

		    case webpg.constants.overlayActions.VERIF:
       		    if (event == "context-menu")
       		        webpg.overlay.block_target = true;
		        webpg.utils.sendRequest({"msg": "verify",
		            "message_event": "context", "selectionData": selection},
                    function(response) {
                        if (response.result.signatures && response.result.data)
                            blockType = webpg.constants.PGPBlocks.PGP_SIGNED_MSG;
                        else
                            blockType = webpg.constants.PGPBlocks.PGP_ENCRYPTED;
                        response.result.original_text = selection.selectionText;
                        webpg.overlay._onRequest({
                            'msg': "insertDecryptedData",
                            'block_type': blockType,
                            'decrypt_status': response.result,
                            'message_event': 'context',
                            'original_text': selection.selectionText
                         });
                    });
        		break;

            case webpg.constants.overlayActions.CRYPTSIGN:
		    case webpg.constants.overlayActions.CRYPT:
		        if (!selection)
		            return false;
       		    if (event == "context-menu")
       		        webpg.overlay.block_target = true;
		        var dialog_type = (action == webpg.constants.overlayActions.CRYPTSIGN) ?
		            'encryptsign' : 'encrypt';
                webpg.overlay._onRequest({'msg': 'openDialog',
                    'data': selection.selectionText,
                    'pre_selection': selection.pre_selection,
                    'post_selection': selection.post_selection,
                    'dialog_type': dialog_type
                });
                break;

		    case webpg.constants.overlayActions.DECRYPT:
		        if (!selection)
		            break;
       		    if (event == "context-menu")
       		        webpg.overlay.block_target = true;
		        webpg.utils.sendRequest({
                    // WebPG found a PGP MESSAGE, but it could be signed. Lets gpgVerify first
                    'msg': 'verify',
                    'data': selection.selectionText,
                    'message_event': 'context'},
                    function(response) {
                        if (response.result.signatures && response.result.data)
                            blockType = webpg.constants.PGPBlocks.PGP_SIGNED_MSG;
                        else
                            blockType = webpg.constants.PGPBlocks.PGP_ENCRYPTED;
                        response.result.original_text = selection.selectionText;
                        webpg.overlay._onRequest({
                            'msg': "insertDecryptedData",
                            'block_type': blockType,
                            'decrypt_status': response.result,
                            'message_event': (sender.source == "toolbar" && sender.dialog) ? 'editor' : 'context',
                            'original_text': selection.selectionText
                         });
                    }
                );
                break;

		    case webpg.constants.overlayActions.SYMCRYPT:
       		    if (event == "context-menu")
       		        webpg.overlay.block_target = true;
		        webpg.utils.sendRequest({
                    'msg': 'symmetricEncrypt',
                    'data': selection.selectionText,
                    'pre_selection': selection.pre_selection,
                    'post_selection': selection.post_selection,
                    'message_event': 'context',
                    'dialog_type': 'symcrypt'}
                );
                break;

		    case webpg.constants.overlayActions.IMPORT:
                webpg.overlay._onRequest({'msg': 'openDialog',
                    'dialog_type': 'import',
                    'data': selection.selectionText
                });
                break;

		    case webpg.constants.overlayActions.EXPORT:
       		    if (event == "context-menu")
       		        webpg.overlay.block_target = true;
		        webpg.utils.sendRequest({"msg": "enabled_keys"}, function(response) {
		            var enabled_keys = response.result;
		            if (enabled_keys.length > 1) {
                        webpg.overlay._onRequest({'msg': 'openDialog',
                            'dialog_type': 'export'
                        });
		            } else {
		                webpg.utils.sendRequest({"msg": "export", "keyid": enabled_keys[0]},
		                function(pubkey) {
                            webpg.overlay._onRequest({'msg': 'insertPublicKey', 'data': pubkey.result});
                        });
                    }
                });
                break;

		    case webpg.constants.overlayActions.MANAGER:
		        if (webpg.utils.detectedBrowser['vendor'] == "mozilla") {
                    webpg.utils.openNewTab(webpg.utils.resourcePath +
                        "XULContent/options.xul?options_tab=1");
			    } else if (webpg.utils.detectedBrowser['product'] == "chrome") {
                    var url = "key_manager.html?auto_init=true"
                    if (typeof(sender.tab)=='undefined') {
                        sender.tab = {'index': null };
                    } else {
                        sender.tab.index += 1;
                    }
                    webpg.utils.openNewTab(webpg.utils.resourcePath + url, sender.tab.index);
                }
			    break;

            case webpg.constants.overlayActions.OPTS:
		        if (webpg.utils.detectedBrowser['vendor'] == "mozilla") {
                    webpg.utils.openNewTab(webpg.utils.resourcePath +
                        "XULContent/options.xul?options_tab=0");
			    } else if (webpg.utils.detectedBrowser['product'] == "chrome") {
                    var url = "options.html?auto_init=true";
                    if (typeof(sender.tab)=='undefined') {
                        sender.tab = {'index': null };
                    } else {
                        sender.tab.index += 1;
                    }
                    webpg.utils.openNewTab(webpg.utils.resourcePath + url, sender.tab.index);
                }
			    break;

		    case webpg.constants.overlayActions.EDITOR:
		        if (!selection)
		            return false;
                webpg.overlay._onRequest({'msg': 'openDialog',
                    'data': selection.selectionText,
                    'pre_selection': selection.pre_selection,
                    'post_selection': selection.post_selection,
                    'dialog_type': 'editor'
                });
                break;

            case webpg.constants.overlayActions.ABOUT:
		        if (webpg.utils.detectedBrowser['vendor'] == "mozilla") {
                    webpg.utils.openNewTab(webpg.utils.resourcePath +
                        "XULContent/options.xul?options_tab=2");
			    } else if (webpg.utils.detectedBrowser['product'] == "chrome") {
                    var url = "about.html?auto_init=true";
                    webpg.utils.openNewTab(webpg.utils.resourcePath + url, sender.tab.index + 1);
                }
			    break;
        }
	},


    /*
        Function: listenerUnload
            This function unloads then event listener when the window/tab is closed.

        Parameters:
            aEvent - <event> The window event
    */
    listenerUnload: function(aEvent) {
        webpg.initialized = false;
    },

};

if (webpg.utils.detectedBrowser['vendor'] == "mozilla") {
    if (webpg.utils.detectedBrowser['product'] == "thunderbird") {
//        window.addEventListener("load", webpg.overlay.init, false);
    } else {
        webpg.appcontent = document.getElementById("appcontent") || document;
        webpg.appcontent.addEventListener("DOMContentLoaded", webpg.overlay.init, false);
    }
} else {
    webpg.overlay.init();
}
/* ]]> */
