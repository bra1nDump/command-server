//import { open } from "fs/promises";
import { Minimatch } from "minimatch";
import * as vscode from "vscode";

import { getResponsePath } from "./paths";
import { any } from "./regex";
import { Request, Response } from "./types";

import * as http from "http";

function getRequestJSON(req: http.IncomingMessage) {
  return new Promise<any>((resolve, reject) => {
    var body = "";
    req.on("data", function (chunk) {
      body += chunk;
    });
    req.on("end", () => resolve(JSON.parse(body)));
  });
}

function createServer(): Promise<[http.Server, Request, http.ServerResponse]> {
  return new Promise((resolve, reject) => {
    const port = 7001;

    const server = http.createServer(async (req, res) => {
      const requestJSON = await getRequestJSON(req);

      res.setHeader('Content-Type', 'text/plain');

      resolve([server, requestJSON, res])
    });

    server.listen(port, () => {
      console.log(`Server running at ${port}`);
    })

    setTimeout(() => {
      server.close();
      reject('Timed out waiting for command');
    }, 25);
  });
}

export default class CommandRunner {
  allowRegex!: RegExp;
  denyRegex!: RegExp | null;
  backgroundWindowProtection!: boolean;

  constructor() {
    this.reloadConfiguration = this.reloadConfiguration.bind(this);
    this.runCommand = this.runCommand.bind(this);

    this.reloadConfiguration();
    vscode.workspace.onDidChangeConfiguration(this.reloadConfiguration);
  }

  reloadConfiguration() {
    const allowList = vscode.workspace
      .getConfiguration("command-server")
      .get<string[]>("allowList")!;

    this.allowRegex = any(
      ...allowList.map((glob) => new Minimatch(glob).makeRe())
    );

    const denyList = vscode.workspace
      .getConfiguration("command-server")
      .get<string[]>("denyList")!;

    this.denyRegex =
      denyList.length === 0
        ? null
        : any(...denyList.map((glob) => new Minimatch(glob).makeRe()));

    this.backgroundWindowProtection = vscode.workspace
      .getConfiguration("command-server")
      .get<boolean>("backgroundWindowProtection")!;
  }

  /**
   * Reads a command from the request file and executes it.  Writes information
   * about command execution to the result of the command to the response file,
   * If requested, will wait for command to finish, and can also write command
   * output to response file.  See also documentation for Request / Response
   * types.
   */
  async runCommand() {
    const responseFile : any = undefined;//await open(getResponsePath(), "wx");

    var server: http.Server;
    var request: Request;
    var response: http.ServerResponse;

    try {
      // request = await readRequest();
      //console.time();
      [server, request, response] = await createServer();
      //console.timeEnd();
    } catch (err) {
      //await responseFile.close();
      throw err;
    }

    const { commandId, args, uuid, returnCommandOutput, waitForFinish } =
      request;

    const warnings = [];

    try {
      if (!vscode.window.state.focused) {
        if (this.backgroundWindowProtection) {
          throw new Error("This editor is not active");
        } else {
          warnings.push("This editor is not active");
        }
      }

      if (!commandId.match(this.allowRegex)) {
        throw new Error("Command not in allowList");
      }

      if (this.denyRegex != null && commandId.match(this.denyRegex)) {
        throw new Error("Command in denyList");
      }

      const commandPromise = vscode.commands.executeCommand(commandId, ...args);

      var commandReturnValue = null;

      if (returnCommandOutput) {
        commandReturnValue = await commandPromise;
      } else if (waitForFinish) {
        await commandPromise;
      }

      response.statusCode = 200;
      response.end(JSON.stringify({
          error: null,
          uuid,
          returnValue: commandReturnValue,
          warnings,
        })
      );
      server.close();
      // await writeResponse(responseFile, {
      //   error: null,
      //   uuid,
      //   returnValue: commandReturnValue,
      //   warnings,
      // });
    } catch (err) {
      response.statusCode = 200;
      response.end(JSON.stringify({
          error: err.message,
          uuid,
          warnings,
        })
      );
      server.close();
      // await writeResponse(responseFile, {
      //   error: err.message,
      //   uuid,
      //   warnings,
      // });
    }

    ////await responseFile.close();
  }
}
