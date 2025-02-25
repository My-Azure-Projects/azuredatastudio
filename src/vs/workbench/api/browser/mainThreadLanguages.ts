/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { MainThreadLanguagesShape, MainContext, IExtHostContext, ExtHostContext, ExtHostLanguagesShape } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IPosition } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { StandardTokenType } from 'vs/editor/common/modes';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ILanguageStatus, ILanguageStatusService } from 'vs/workbench/services/languageStatus/common/languageStatusService';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';

@extHostNamedCustomer(MainContext.MainThreadLanguages)
export class MainThreadLanguages implements MainThreadLanguagesShape {

	private readonly _disposables = new DisposableStore();
	private readonly _proxy: ExtHostLanguagesShape;

	private readonly _status = new Map<number, IDisposable>();

	constructor(
		_extHostContext: IExtHostContext,
		@IModeService private readonly _modeService: IModeService,
		@IModelService private readonly _modelService: IModelService,
		@ITextModelService private _resolverService: ITextModelService,
		@ILanguageStatusService private readonly _languageStatusService: ILanguageStatusService,
	) {
		this._proxy = _extHostContext.getProxy(ExtHostContext.ExtHostLanguages);

		this._proxy.$acceptLanguageIds(_modeService.getRegisteredModes());
		this._disposables.add(_modeService.onLanguagesMaybeChanged(e => {
			this._proxy.$acceptLanguageIds(_modeService.getRegisteredModes());
		}));
	}

	dispose(): void {
		this._disposables.dispose();

		for (const status of this._status.values()) {
			status.dispose();
		}
		this._status.clear();
	}

	async $changeLanguage(resource: UriComponents, languageId: string): Promise<void> {

		const validLanguageId = this._modeService.validateLanguageId(languageId);
		if (!validLanguageId || validLanguageId !== languageId) {
			return Promise.reject(new Error(`Unknown language id: ${languageId}`));
		}

		const uri = URI.revive(resource);
		const ref = await this._resolverService.createModelReference(uri);
		try {
			this._modelService.setMode(ref.object.textEditorModel, this._modeService.create(languageId));
		} finally {
			ref.dispose();
		}
	}

	async $tokensAtPosition(resource: UriComponents, position: IPosition): Promise<undefined | { type: StandardTokenType, range: IRange }> {
		const uri = URI.revive(resource);
		const model = this._modelService.getModel(uri);
		if (!model) {
			return undefined;
		}
		model.tokenizeIfCheap(position.lineNumber);
		const tokens = model.getLineTokens(position.lineNumber);
		const idx = tokens.findTokenIndexAtOffset(position.column - 1);
		return {
			type: tokens.getStandardTokenType(idx),
			range: new Range(position.lineNumber, 1 + tokens.getStartOffset(idx), position.lineNumber, 1 + tokens.getEndOffset(idx))
		};
	}

	// --- language status

	$setLanguageStatus(handle: number, status: ILanguageStatus): void {
		this._status.get(handle)?.dispose();
		this._status.set(handle, this._languageStatusService.addStatus(status));
	}

	$removeLanguageStatus(handle: number): void {
		this._status.get(handle)?.dispose();
	}
}
