/*
    Main processing handler for popup.html

*/
var main = (function () {
    "use strict";

    // this will be called when message listener fires
    function onMessageListener(message) {
        // convert the string returned from content script back into a DOM
        let dom = new DOMParser().parseFromString(message.document, "text/html");
        populateControlsWithDom(message.url, dom);
    };

    // details 
    let initalWebPage = null;
    let parser = null;
    let userPreferences = null;

    // register listener that is invoked when script injected into HTML sends its results
    try {
        // note, this will throw if not running as an extension.
        chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
            if (request.messageType == "ParseResults") {
                util.log("addListener");
                util.log(request);
                onMessageListener(request);
            }
        });
    }
    catch (chromeError)
    {
        util.log(chromeError);
    }

    // extract urls from DOM and populate control
    function processInitialHtml(url, dom) {
        if (setParser(url)) {
            try {
                userPreferences.addObserver(parser);
                let metaInfo = parser.getEpubMetaInfo(dom);
                populateMetaInfo(metaInfo);
                parser.populateUI(dom);
                parser.onLoadFirstPage(url, dom);
            } catch (error) {
                alert("Error parsing HTML: " + error.stack);
            }
        }
    }

    function populateMetaInfo(metaInfo) {
        setUiFieldToValue("startingUrlInput", metaInfo.uuid);
        setUiFieldToValue("titleInput", metaInfo.title);
        setUiFieldToValue("authorInput", metaInfo.author);
        setUiFieldToValue("languageInput", metaInfo.language);
        setUiFieldToValue("fileNameInput", metaInfo.fileName);

        if (metaInfo.seriesName !== null) {
            document.getElementById("seriesRow").hidden = false;
            document.getElementById("volumeRow").hidden = false;
            setUiFieldToValue("seriesNameInput", metaInfo.seriesName);
            setUiFieldToValue("seriesIndexInput", metaInfo.seriesIndex);
        }

        setUiFieldToValue("translatorInput", metaInfo.translator);
        setUiFieldToValue("fileAuthorAsInput", metaInfo.fileAuthorAs);
    }

    function setUiFieldToValue(elementId, value) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            element.value = (value == null) ? "" : value;
        } else {
            alert("ERROR: Unhandled field type");
        }
    }

    function metaInfoFromContorls() {
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = getValueFromUiField("startingUrlInput");
        metaInfo.title = getValueFromUiField("titleInput");
        metaInfo.author = getValueFromUiField("authorInput");
        metaInfo.language = getValueFromUiField("languageInput");
        metaInfo.fileName = getValueFromUiField("fileNameInput");

        if (document.getElementById("seriesRow").hidden === false) {
            metaInfo.seriesName = getValueFromUiField("seriesNameInput");
            metaInfo.seriesIndex = getValueFromUiField("seriesIndexInput");
        }

        metaInfo.translator = getValueFromUiField("translatorInput");
        metaInfo.fileAuthorAs = getValueFromUiField("fileAuthorAsInput");
        metaInfo.styleSheet = userPreferences.styleSheet;

        return metaInfo;
    }

    function getValueFromUiField(elementId) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            return (element.value === "") ? null : element.value;
        } else {
            alert("ERROR: Unhandled field type");
            return null;
        }
    }

    function fetchContentAndPackEpub() {
        main.getPackEpubButton().disabled = true;
        parser.fetchContent().then(function () {
            packEpub();
        }).catch(function (err) {
            alert(err);
        });
    }

    function packEpub() {
        let metaInfo = metaInfoFromContorls();
        try {
            let epub = new EpubPacker(metaInfo);
            epub.assembleAndSave(metaInfo.fileName, parser.epubItemSupplier());
        } catch (error) {
            alert("Error packing EPUB. Error: " + error.stack);
        }
    }

    function getActiveTabDOM(tabId) {
        chrome.tabs.executeScript(tabId, { file: "js/ContentScript.js" },
            function (result) {
                if (chrome.runtime.lastError) {
                    util.log(chrome.runtime.lastError.message);
                };
            }
        );
    }

    function populateControls() {
        loadUserPreferences();
        if (isRunningInTabMode()) {
            configureForTabMode();
        } else if (isRunningFromWebPageOrLocalFile()) {
            // nothing to do, user will need to supply URL
        } else {
            // running as an extention, try get active tab
            getActiveTabDOM();
        }
    }

    function loadUserPreferences() {
        userPreferences = UserPreferences.readFromLocalStorage();
        userPreferences.writeToUi();
        userPreferences.hookupUi();
    }

    function isRunningFromWebPageOrLocalFile() {
        let protocol = window.location.protocol;
        return (protocol.startsWith("http") || protocol.startsWith("file"));
    }

    function isRunningInTabMode() {
        // if query string supplied, we're running in Tab mode.
        let search = window.location.search;
        return !util.isNullOrEmpty(search);
    }

    function populateControlsWithDom(url, dom) {
        initalWebPage = dom;
        setUiFieldToValue("startingUrlInput", url);

        // set the base tag, in case server did not supply it 
        util.setBaseTag(url, initalWebPage);
        processInitialHtml(url, initalWebPage);
    }

    function setParser(url) {
        parser = parserFactory.fetch(url);
        if (parser === undefined) {
            alert("No parser found for this URL.");
            return false;
        }
        getLoadAndAnalyseButton().hidden = true;
        return true;
    }

    // called when the "Diagnostics" check box is ticked or unticked
    function onDiagnosticsClick() {
        let enable = document.getElementById("diagnosticsCheckBoxInput").checked;
        document.getElementById("reloadButton").hidden = !enable;
        document.getElementById("packRawButton").hidden = !enable;
        document.getElementById("fetchChaptersButton").hidden = !enable;
        document.getElementById("fetchImagesButton").hidden = !enable;
    }

    function onAdvancedOptionsClick() {
        let section = document.getElementById("advancedOptionsSection");
        section.hidden = !section.hidden;
    }

    function onStylesheetToDefaultClick() {
        document.getElementById("stylesheetInput").value = EpubMetaInfo.getDefaultStyleSheet();
        userPreferences.readFromUi();
    }

    function openTabWindow() {
        // open new tab window, passing ID of open tab with content to convert to epub as query parameter.
        getActiveTab().then(function (tabId) {
            let url = chrome.extension.getURL("popup.html") + "?id=";
            url += tabId;
            chrome.tabs.create({ url: url });
            window.close();
        });
    }

    function getActiveTab() {
        return new Promise(function (resolve, reject) {
            chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
                if ((tabs != null) && (0 < tabs.length)) {
                    resolve(tabs[0].id);
                } else {
                    reject();
                };
            });
        });
    }

    function onLoadAndAnalyseButtonClick() {
        // load page via XmlHTTPRequest
        let url = getValueFromUiField("startingUrlInput");
        getLoadAndAnalyseButton().disabled = true;
        let client = new HttpClient();
        return client.fetchHtml(url).then(function (xhr) {
            populateControlsWithDom(url, xhr.responseXML);
            getLoadAndAnalyseButton().disabled = false;
        }).catch(function (error) {
            // ToDo, implement error handler.
            getLoadAndAnalyseButton().disabled = false;
            alert(error);
        });
    }

    function configureForTabMode() {
        getActiveTabDOM(extractTabIdFromQueryParameter());
    }

    function extractTabIdFromQueryParameter() {
        let windowId = window.location.search.split("=")[1];
        if (!util.isNullOrEmpty(windowId)) {
            return parseInt(windowId, 10);
        }
    }

    function getPackEpubButton() {
        return document.getElementById("packEpubButton");
    }

    function getLoadAndAnalyseButton() {
        return document.getElementById("loadAndAnalyseButton");
    }

    function resetUI() {
        initalWebPage = null;
        parser = null;
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = "";
        populateMetaInfo(metaInfo);
        getLoadAndAnalyseButton().hidden = false;
        main.getPackEpubButton().disabled = false;
        document.getElementById("fetchProgress").value = 0;
    }

    // actions to do when window opened
    window.onload = function () {
        userPreferences = UserPreferences.readFromLocalStorage();
        if (isRunningInTabMode() || !userPreferences.alwaysOpenAsTab) {
            // add onClick event handlers
            getPackEpubButton().onclick = fetchContentAndPackEpub;
            document.getElementById("diagnosticsCheckBoxInput").onclick = onDiagnosticsClick;
            document.getElementById("reloadButton").onclick = populateControls;
            document.getElementById("advancedOptionsButton").onclick = onAdvancedOptionsClick;
            document.getElementById("stylesheetToDefaultButton").onclick = onStylesheetToDefaultClick;
            document.getElementById("resetButton").onclick = resetUI;
            getLoadAndAnalyseButton().onclick = onLoadAndAnalyseButtonClick;
            populateControls();
        } else {
            openTabWindow();
        }
    }

    return {
        getPackEpubButton: getPackEpubButton
    };
})();

