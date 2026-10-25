/**
 * 世界书随卡清理 (Lorebook Cleaner) for SillyTavern 1.19+
 *
 * 删除角色卡时，检查该卡绑定的世界书（data.extensions.world），
 * 若没有其他角色卡引用，弹窗询问是否一并删除。
 * 删除前会检查共享引用；被其他卡使用时默认跳过。
 */

import {
    eventSource,
    event_types,
    getRequestHeaders,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { deleteWorldInfo } from '../../../world-info.js';

const MODULE_KEY = 'lorebook_cleaner';
const LOG_PREFIX = '[世界书随卡清理]';

const DEFAULT_SETTINGS = {
    enabled: true,      // 总开关
    confirmEach: true,  // 每次删除前弹窗确认
    skipShared: true,   // 世界书仍被其他卡使用时直接跳过
};

/** 批量删卡时，防止同一本世界书被重复处理 */
const processing = new Set();

function getSettings() {
    if (!extension_settings[MODULE_KEY] || typeof extension_settings[MODULE_KEY] !== 'object') {
        extension_settings[MODULE_KEY] = { ...DEFAULT_SETTINGS };
    }
    const settings = extension_settings[MODULE_KEY];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (typeof settings[key] !== 'boolean') {
            settings[key] = value;
        }
    }
    return settings;
}

function escapeHtml(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, (char) => map[char]);
}

/** 取出角色卡绑定的独立世界书名（内嵌 character_book 不在此列） */
function getBoundWorld(character) {
    const world = character?.data?.extensions?.world;
    return typeof world === 'string' ? world.trim() : '';
}

/** 查询还有哪些角色卡引用这本世界书 */
async function getOtherCharacterNames(world) {
    const response = await fetch('/api/characters/all', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    const all = await response.json();
    if (!Array.isArray(all)) {
        return [];
    }
    return all
        .filter((char) => getBoundWorld(char) === world)
        .map((char) => char?.name || char?.avatar || '未命名角色');
}

async function handleCharacterDeleted(payload) {
    const settings = getSettings();
    if (!settings.enabled) {
        return;
    }

    const character = payload?.character;
    const world = getBoundWorld(character);
    if (!world) {
        // 卡片没有绑定独立世界书；若世界书是内嵌在卡里的，删卡时已一并消失
        return;
    }
    if (processing.has(world)) {
        return;
    }

    processing.add(world);
    try {
        let others;
        try {
            others = await getOtherCharacterNames(world);
        } catch (error) {
            toastr.error(`检查世界书引用失败：${error.message}`, '世界书随卡清理');
            return;
        }

        const characterName = escapeHtml(character?.name || '角色');
        const worldName = escapeHtml(world);

        if (others.length > 0) {
            const list = others.slice(0, 10).map(escapeHtml).join('、') + (others.length > 10 ? ' 等' : '');
            if (settings.skipShared) {
                toastr.warning(`世界书「${world}」仍被 ${others.length} 张角色卡使用，已跳过删除`, '世界书随卡清理');
                return;
            }
            const result = await callGenericPopup(
                `<h3>世界书仍在使用</h3>
                 <p>世界书「<b>${worldName}</b>」还被 ${others.length} 张角色卡引用：</p>
                 <p>${list}</p>
                 <p>删除后，这些角色卡将失去这本世界书。仍然删除吗？</p>`,
                POPUP_TYPE.CONFIRM,
                '',
                { okButton: '仍然删除', cancelButton: '保留' },
            );
            if (result !== POPUP_RESULT.AFFIRMATIVE) {
                return;
            }
        } else if (settings.confirmEach) {
            const result = await callGenericPopup(
                `<h3>同时删除世界书？</h3>
                 <p>角色卡「<b>${characterName}</b>」已删除，它绑定的世界书是：</p>
                 <p><b>${worldName}</b></p>
                 <p>没有其他角色卡引用这本世界书。删除后不可恢复（不做备份）。</p>`,
                POPUP_TYPE.CONFIRM,
                '',
                { okButton: '删除世界书', cancelButton: '保留世界书' },
            );
            if (result !== POPUP_RESULT.AFFIRMATIVE) {
                toastr.info(`已保留世界书「${world}」`, '世界书随卡清理');
                return;
            }
        }

        const deleted = await deleteWorldInfo(world);
        if (deleted) {
            toastr.success(`已删除世界书「${world}」`, '世界书随卡清理');
        } else {
            toastr.warning(`世界书「${world}」不存在或已被删除`, '世界书随卡清理');
        }
    } catch (error) {
        console.error(LOG_PREFIX, error);
        toastr.error(`处理世界书时出错：${error.message}`, '世界书随卡清理');
    } finally {
        processing.delete(world);
    }
}

function addSettingsUI() {
    const settings = getSettings();
    const html = `
    <div class="lorebook-cleaner-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>世界书随卡清理</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label" for="lbc_enabled">
                    <input type="checkbox" id="lbc_enabled">
                    <span>删除角色卡时，询问是否删除它绑定的世界书</span>
                </label>
                <label class="checkbox_label" for="lbc_confirm">
                    <input type="checkbox" id="lbc_confirm">
                    <span>每次删除前弹窗确认</span>
                </label>
                <label class="checkbox_label" for="lbc_shared">
                    <input type="checkbox" id="lbc_shared">
                    <span>世界书仍被其他角色卡使用时，直接跳过（不删除）</span>
                </label>
                <small>删除立即生效，不做备份；仅处理角色卡绑定的独立世界书文件，不处理卡内内嵌世界书。</small>
            </div>
        </div>
    </div>`;

    $('#extensions_settings').append(html);

    $('#lbc_enabled').prop('checked', settings.enabled).on('change', function () {
        getSettings().enabled = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
    $('#lbc_confirm').prop('checked', settings.confirmEach).on('change', function () {
        getSettings().confirmEach = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
    $('#lbc_shared').prop('checked', settings.skipShared).on('change', function () {
        getSettings().skipShared = Boolean($(this).prop('checked'));
        saveSettingsDebounced();
    });
}

jQuery(async () => {
    addSettingsUI();
    eventSource.on(event_types.CHARACTER_DELETED, handleCharacterDeleted);
    console.log(`${LOG_PREFIX} 已加载，监听 ${event_types.CHARACTER_DELETED}`);
});
