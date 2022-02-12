import * as vscode from 'vscode';
import { realpathSync } from 'fs';
import { sep } from 'path';
import { GitExtension } from './git';
import { Hash } from 'crypto';

// https://github.com/microsoft/vscode/tree/master/extensions/git#api
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports;
const git = gitExtension.getAPI(1);

interface UrlRule {
	remotePattern?: string;
	webUrls?: string[];
}

function findUrl(config: vscode.WorkspaceConfiguration, cloneUrl: string, filename: string, branch: string | undefined, startLine: number | undefined, endLine: number | undefined, hash: string | undefined): string {
	const rules: UrlRule[] = [
		{
			remotePattern: config.get<string>('remotePattern'),
			webUrls: config.get<string[]>('webUrls'),
		},
		...config.get<UrlRule[]>('otherPatterns')!,
	];
	for(const rule of rules) {
		if(rule.remotePattern?.length && rule.webUrls?.length) {
			const m = cloneUrl.match(rule.remotePattern);
			if(m) {
				for(const webUrl of rule.webUrls) {
					try {
						return webUrl.replace(/\${([^}]+)}/gi, (substr, name: string) => {
							switch(name.toLowerCase()) {
								case 'filename':
									return filename;
								case 'branch':
									if(branch) {
										return branch;
									}
									break;
								case 'startline':
									if(startLine) {
										return `${startLine}`;
									}
									break;
								case 'endline':
									if(endLine) {
										return `${endLine}`;
									}
									break;
								case 'hash':
									if(hash) {
										return hash;
									}
									break;
								default:
									const num = +name;
									if(!isNaN(num) && num >= 1 && num <= m.length) {
										return m[num];
									}
									break;
							}
							throw new Error("Unsupported variable");
						});
					} catch(e) {}
				}
			}
		}
	}
	throw new Error(`No pattern matches clone URL: ${cloneUrl}`);
}

function openLink(includeRegion: boolean | undefined, includeBranch: boolean | undefined, includeHash: boolean | undefined, actions?: string[] | undefined) {
	const config = vscode.workspace.getConfiguration('gitWebLink');
	if(vscode.window.activeTextEditor?.document.isUntitled) {
		vscode.window.showErrorMessage("Current file is unsaved");
		return;
	}
	let filename = vscode.window.activeTextEditor?.document.fileName;
	if(!filename) {
		vscode.window.showErrorMessage("No file currently focused");
		return;
	}
	// git.getRepository() doesn't work on symlinks
	filename = realpathSync(filename) || filename;
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

	if(includeBranch === undefined && includeHash === undefined && includeRegion === undefined) {
		const picks: vscode.QuickPickItem[] = [{
			label: '$(git-pull-request) Include Branch',
			description: 'Include current branch in URL',
		}, {
			label: '$(git-commit) Include Hash',
			description: 'Include current commit hash in URL',
		}];
		if(vscode.window.activeTextEditor?.selection) {
			picks.push({
				label: '$(list-selection) Include Selection',
				description: 'Include selected lines in URL',
			});
		}
		picks.push({
			label: '$(browser) Open',
			description: 'Open URL in browser',
			picked: true,
		}, {
			label: '$(clippy) Copy',
			description: 'Copy URL to clipboard',
		});
		vscode.window.showQuickPick(picks, {
			canPickMany: true,
		}).then(values => {
			if(values === undefined) {
				return;
			}
			let includeBranch = false, includeHash = false, includeRegion = false;
			const actions: string[] = [];
			for(const { label } of values) {
				// Strip icon
				const text = label.replace(/^\$\([^)]+\) /, '');
				switch(text) {
					case 'Include Branch':
						includeBranch = true;
						break;
					case 'Include Hash':
						includeHash = true;
						break;
					case 'Include Selection':
						includeRegion = true;
						break;
					case 'Open':
					case 'Copy':
						actions.push(text);
						break;
				}
			}
			openLink(includeRegion, includeBranch, includeHash, actions);
		});
		return;
	}

	if(actions === undefined) {
		actions = [ config.get<string>('defaultAction')! ];
	}

	let url;
	try {
		const stem = filename.substring(repoRoot.length).replace(/\\/g, '/');
		const branch = includeBranch ? repo.state.HEAD?.name : undefined;
		const hash = includeHash ? repo.state.HEAD?.commit : undefined;
		const sel = includeRegion ? vscode.window.activeTextEditor?.selection : undefined;
		const startLine = sel ? sel.start.line + 1 : undefined;
		const endLine = sel ? sel.end.line + (sel.start.line > sel.end.line && sel.end.character === 0 ? 0 : 1) : undefined;
		url = findUrl(config, remoteUrl, stem, branch, startLine, endLine, hash);
	} catch(e) {
		vscode.window.showErrorMessage(`${e}`);
		return;
	}
	for(const action of actions) {
		actOnUrl(url, action);
	}
}

function actOnUrl(url: string, action: string) {
	switch(action) {
		case 'Copy':
			vscode.env.clipboard.writeText(url).then(() => vscode.window.showInformationMessage("Git URL written to clipboard"));
			break;
		case 'Notify':
			vscode.window.showInformationMessage(url, 'Open', 'Copy').then(action => action ? actOnUrl(url, action) : undefined);
			break;
		case 'Open':
		default:
			vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
			break;
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('gitWebLink.linkToFile',           () => openLink(false,     false,     false)),
		vscode.commands.registerCommand('gitWebLink.linkToRegion',         () => openLink(true,      false,     false)),
		vscode.commands.registerCommand('gitWebLink.linkToFileOnBranch',   () => openLink(false,     true,      false)),
		vscode.commands.registerCommand('gitWebLink.linkToRegionOnBranch', () => openLink(true,      true,      false)),
		vscode.commands.registerCommand('gitWebLink.linkToFileAtHash',     () => openLink(false,     true,      true)),
		vscode.commands.registerCommand('gitWebLink.linkToRegionAtHash',   () => openLink(true,      true,      true)),
		vscode.commands.registerCommand('gitWebLink.linkWizard',           () => openLink(undefined, undefined, undefined)),
	);
}

export function deactivate() {}
