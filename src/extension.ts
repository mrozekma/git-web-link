import * as vscode from 'vscode';
import { sep } from 'path';
import { GitExtension } from './git';

// https://github.com/microsoft/vscode/tree/master/extensions/git#api
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports;
const git = gitExtension.getAPI(1);
// const isWindows = process.platform === 'win32';

function findUrlBase(cloneUrl: string): string | undefined {
	// Elided; making configurable
	return undefined;
}

function openLink(includeRegion: boolean, includeBranch: boolean) {
	const filename = vscode.window.activeTextEditor?.document.fileName;
	if(!filename) {
		vscode.window.showErrorMessage("No file currently focused");
		return;
	}
	const repo = git.getRepository(vscode.Uri.file(filename));
	if(!repo) {
		vscode.window.showErrorMessage("File not part of a git repository");
		return;
	}
	const repoRoot = repo.rootUri.fsPath + sep;
	if(!filename.startsWith(repoRoot)) {
		vscode.window.showErrorMessage(`File '${filename}' not part of repository '${repoRoot}'`);
		return;
	}
	const remoteName = repo.state.HEAD?.remote || 'origin';
	const remoteUrl = repo.state.remotes.find(remote => remote.name === remoteName)?.fetchUrl;
	if(!remoteUrl) {
		vscode.window.showErrorMessage(`Unable to get fetch URL for remote '${remoteName}'`);
		return;
	}
	const urlBase = findUrlBase(remoteUrl);
	if(!urlBase) {
		vscode.window.showErrorMessage(`Fetch URL for remote '${remoteName}' does not resemble a Bitbucket URL: ${remoteUrl}`);
		return;
	}
	let url = `${urlBase}/${filename.substring(repoRoot.length).replace(/\\/g, '/')}`;
	if(includeBranch && repo.state.HEAD?.name) {
		url += `?at=refs/heads/${repo.state.HEAD.name}`;
	}
	if(includeRegion) {
		const lineRanges = vscode.window.activeTextEditor?.selections.map(sel => sel.isSingleLine ? `${sel.start.line + 1}` : `${sel.start.line + 1}-${sel.end.line + (sel.end.character === 0 ? 0 : 1)}`);
		if(lineRanges) {
			url += `#${lineRanges.join(',')}`;
		}
	}
	// console.log(url);
	vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
}

export function activate(context: vscode.ExtensionContext) {
	const commands = [
		vscode.commands.registerCommand('bitbucket-link.linkToFile',           () => openLink(false, false)),
		vscode.commands.registerCommand('bitbucket-link.linkToRegion',         () => openLink(true,  false)),
		vscode.commands.registerCommand('bitbucket-link.linkToFileOnBranch',   () => openLink(false, true )),
		vscode.commands.registerCommand('bitbucket-link.linkToRegionOnBranch', () => openLink(true,  true )),
	];
	context.subscriptions.push(...commands);
}

export function deactivate() {}
