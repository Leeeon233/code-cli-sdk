export class RequestError extends Error {
    code: number;
    data: any;
    constructor(code, message, data) {
        super(message);
        this.code = code;
        this.name = "RequestError";
        this.data = data;
    }
    /**
     * Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
     */
    static parseError(data, additionalMessage) {
        return new RequestError(-32700, `Parse error${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
    }
    /**
     * The JSON sent is not a valid Request object.
     */
    static invalidRequest(data, additionalMessage) {
        return new RequestError(-32600, `Invalid request${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
    }
    /**
     * The method does not exist / is not available.
     */
    static methodNotFound(method) {
        return new RequestError(-32601, `"Method not found": ${method}`, {
            method,
        });
    }
    /**
     * Invalid method parameter(s).
     */
    static invalidParams(data, additionalMessage) {
        return new RequestError(-32602, `Invalid params${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
    }
    /**
     * Internal JSON-RPC error.
     */
    static internalError(data, additionalMessage) {
        return new RequestError(-32603, `Internal error${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
    }
    /**
     * Authentication required.
     */
    static authRequired(data, additionalMessage) {
        return new RequestError(-32000, `Authentication required${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
    }
    /**
     * Resource, such as a file, was not found
     */
    static resourceNotFound(uri) {
        return new RequestError(-32002, `Resource not found${uri ? `: ${uri}` : ""}`, uri && { uri });
    }
    toResult() {
        return {
            error: {
                code: this.code,
                message: this.message,
                data: this.data,
            },
        };
    }
    toErrorResponse() {
        return {
            code: this.code,
            message: this.message,
            data: this.data,
        };
    }
}