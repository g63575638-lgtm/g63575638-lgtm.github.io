'use strict';
// ============================================================================
// Localisation: English / Русский — every string in menus, HUD, hints, messages
// ============================================================================

const I18N = {
  en: {
    lang_name: 'English',
    presents: 'presents', developed_by: 'Developed by FUTON GROUP', loading: 'Loading', loading_course: 'Preparing the course',
    load_terrain: 'Shaping terrain', load_surface: 'Mowing fairways', load_veg: 'Planting trees', load_meshes: 'Building world', load_sky: 'Painting the sky', load_done: 'Ready',
    enter_vr: 'ENTER VR', play_desktop: 'PLAY ON DESKTOP', vr_unsupported: 'WebXR VR not available in this browser — desktop mode only.', vr_hint: 'Put on your Meta Quest 2 and open this page in Meta Quest Browser.',
    menu_play: 'PLAY', menu_maps: 'MAP SELECTION', menu_settings: 'SETTINGS', menu_language: 'LANGUAGE', menu_credits: 'CREDITS', menu_exit: 'EXIT',
    subtitle: 'Virtual reality golf', back: 'Back', start: 'Start round', select: 'Select', selected: 'Selected', close: 'Close', apply: 'Apply',
    choose_mode: 'Choose game mode', choose_map: 'Choose a course', choose_time: 'Time of day',
    mode_stroke: 'Stroke Play', mode_stroke_d: 'Full 6-hole round. Every stroke counts.', mode_quick: 'Quick Round', mode_quick_d: 'Holes 1–3. Perfect for a short session.',
    mode_practice: 'Practice', mode_practice_d: 'Free play: unlimited shots, pick any hole, no score pressure.', mode_time: 'Time Attack', mode_time_d: '6 holes against the clock. Strokes + time.',
    map_valley: 'GREEN VALLEY', map_valley_d: 'Rolling hills, lakes and forests under snowy peaks.',
    map_coast: 'SUNSET COAST', map_coast_d: 'Clifftop holes over the ocean, palms and golden beaches.',
    map_mountain: 'MOUNTAIN RESORT', map_mountain_d: 'Alpine fairways, pines, granite and glacial lakes.',
    time_morning: 'Morning', time_noon: 'Midday', time_sunset: 'Sunset', time_default: 'Default',
    holes: 'holes', par: 'Par', hole: 'Hole', strokes: 'Strokes', total: 'Total', score: 'Score', to_pin: 'To pin', club: 'Club', wind: 'Wind', time: 'Time', lie: 'Lie', length: 'Length',
    settings: 'Settings', tab_game: 'Gameplay', tab_comfort: 'Movement & comfort', tab_graphics: 'Graphics', tab_audio: 'Audio', tab_lang: 'Language',
    s_handed: 'Golfer', s_right: 'Right-handed', s_left: 'Left-handed', s_auto_club: 'Auto club selection', s_aim: 'Aim line on green', s_trail: 'Ball trail', s_pin: 'Pin marker', s_assist: 'Power assist', s_club_angle: 'Club angle', s_units: 'Units', s_meters: 'Meters', s_yards: 'Yards',
    s_move: 'Locomotion', s_move_both: 'Smooth + teleport', s_move_tp: 'Teleport only', s_speed: 'Walk speed', s_turn: 'Turning', s_turn_snap: 'Snap turn', s_turn_smooth: 'Smooth turn', s_snap_angle: 'Snap angle', s_vignette: 'Comfort vignette', s_height: 'Height offset', s_seated: 'Seated mode',
    s_quality: 'Quality preset', q_low: 'Performance', q_med: 'Balanced', q_high: 'Quality', s_shadows: 'Shadows', s_grass: 'Grass density', s_refresh: 'Refresh rate', s_foveation: 'Foveation', s_res: 'Resolution scale',
    s_master: 'Master volume', s_sfx: 'Effects', s_amb: 'Nature ambience', s_ui: 'Interface', on: 'On', off: 'Off', low: 'Low', medium: 'Medium', high: 'High',
    language: 'Language', credits: 'Credits',
    credits_body: 'FUTON GOLF VR\n\nA game by FUTON GROUP\n\nGame design · Physics · Engine · Art · Audio\nFUTON GROUP\n\nBuilt with a custom WebGL2 + WebXR engine.\nAll models, terrain, sky and sounds are procedurally generated.\n\nThank you for playing!',
    pause: 'Paused', resume: 'Resume', restart_hole: 'Restart hole', scorecard: 'Scorecard', main_menu: 'Main menu', next_hole: 'Next hole', finish: 'Finish', play_again: 'Play again', prev_hole: 'Previous hole', skip_hole: 'Skip hole',
    hint_grab: 'Squeeze GRIP near the club to pick it up', hint_swing: 'Swing through the ball — the club hits it physically', hint_goto: 'B — go to ball   ·   X — find ball', hint_club: 'A — next club · click right stick — previous club', hint_move: 'Left stick: walk   ·   Right stick: turn / push forward to teleport',
    hint_recall: 'Hold GRIP with an empty hand to recall the club', hint_menu: 'Y — pause menu', hint_practice: 'Practice: trigger + B resets the ball to the tee',
    tee_off: 'Tee off', on_green: 'On the green', in_hole: 'In the hole!', water: 'Water hazard', water_pen: 'Water hazard · 1 penalty stroke', ob: 'Out of bounds · stroke and distance', lost: 'Ball lost', picked_up: 'Picked up',
    shot_info: '{d} {u} · ball {bs} km/h', carry: 'Carry', roll: 'Roll', club_speed: 'Club speed', ball_speed: 'Ball speed', launch: 'Launch', spin: 'Spin', distance: 'Distance',
    sc_albatross: 'Albatross!', sc_eagle: 'Eagle!', sc_birdie: 'Birdie!', sc_par: 'Par', sc_bogey: 'Bogey', sc_double: 'Double bogey', sc_triple: 'Triple bogey', sc_over: '+{n}', sc_ace: 'HOLE IN ONE!',
    round_complete: 'Round complete', best: 'Best', new_best: 'New personal best!', even: 'E', vs_par: 'vs par', time_total: 'Time',
    surf_rough: 'Rough', surf_fairway: 'Fairway', surf_green: 'Green', surf_sand: 'Bunker', surf_tee: 'Tee', surf_fringe: 'Fringe', surf_deep: 'Deep rough', surf_water: 'Water', surf_rock: 'Rocks', surf_beach: 'Beach', surf_path: 'Path',
    ball_found: 'Ball highlighted', club_recalled: 'Club returned to your hand', desktop_help: 'WASD move · Mouse look (click) · Hold left mouse & drag to swing · 1-9 clubs · B go to ball · F find ball · Esc pause',
    perf_warn: 'Lowering detail to keep the frame rate smooth', hand_left: 'Left hand', hand_right: 'Right hand', practice_reset: 'Ball reset',
  },
  ru: {
    lang_name: 'Русский',
    presents: 'представляет', developed_by: 'Разработано FUTON GROUP', loading: 'Загрузка', loading_course: 'Подготовка поля',
    load_terrain: 'Формируем рельеф', load_surface: 'Стрижём фервеи', load_veg: 'Сажаем деревья', load_meshes: 'Строим мир', load_sky: 'Рисуем небо', load_done: 'Готово',
    enter_vr: 'ВОЙТИ В VR', play_desktop: 'ИГРАТЬ НА ПК', vr_unsupported: 'WebXR VR недоступен в этом браузере — только режим ПК.', vr_hint: 'Наденьте Meta Quest 2 и откройте эту страницу в Meta Quest Browser.',
    menu_play: 'ИГРАТЬ', menu_maps: 'ВЫБОР КАРТЫ', menu_settings: 'НАСТРОЙКИ', menu_language: 'ЯЗЫК', menu_credits: 'АВТОРЫ', menu_exit: 'ВЫХОД',
    subtitle: 'Гольф в виртуальной реальности', back: 'Назад', start: 'Начать раунд', select: 'Выбрать', selected: 'Выбрано', close: 'Закрыть', apply: 'Применить',
    choose_mode: 'Выберите режим игры', choose_map: 'Выберите поле', choose_time: 'Время суток',
    mode_stroke: 'Строук-плей', mode_stroke_d: 'Полный раунд из 6 лунок. Важен каждый удар.', mode_quick: 'Быстрый раунд', mode_quick_d: 'Лунки 1–3. Идеально для короткой игры.',
    mode_practice: 'Тренировка', mode_practice_d: 'Свободная игра: без ограничений ударов, любая лунка, без счёта.', mode_time: 'На время', mode_time_d: '6 лунок против часов. Удары + время.',
    map_valley: 'ЗЕЛЁНАЯ ДОЛИНА', map_valley_d: 'Холмы, озёра и леса у подножия снежных вершин.',
    map_coast: 'ЗАКАТНОЕ ПОБЕРЕЖЬЕ', map_coast_d: 'Лунки на скалах над океаном, пальмы и золотые пляжи.',
    map_mountain: 'ГОРНЫЙ КУРОРТ', map_mountain_d: 'Альпийские фервеи, сосны, гранит и ледниковые озёра.',
    time_morning: 'Утро', time_noon: 'Полдень', time_sunset: 'Закат', time_default: 'Авто',
    holes: 'лунок', par: 'Пар', hole: 'Лунка', strokes: 'Удары', total: 'Итого', score: 'Счёт', to_pin: 'До флага', club: 'Клюшка', wind: 'Ветер', time: 'Время', lie: 'Лежка', length: 'Длина',
    settings: 'Настройки', tab_game: 'Игра', tab_comfort: 'Движение и комфорт', tab_graphics: 'Графика', tab_audio: 'Звук', tab_lang: 'Язык',
    s_handed: 'Игрок', s_right: 'Правша', s_left: 'Левша', s_auto_club: 'Автовыбор клюшки', s_aim: 'Линия прицела на грине', s_trail: 'След мяча', s_pin: 'Маркер флага', s_assist: 'Усиление удара', s_club_angle: 'Угол клюшки', s_units: 'Единицы', s_meters: 'Метры', s_yards: 'Ярды',
    s_move: 'Передвижение', s_move_both: 'Плавное + телепорт', s_move_tp: 'Только телепорт', s_speed: 'Скорость ходьбы', s_turn: 'Поворот', s_turn_snap: 'Пошаговый', s_turn_smooth: 'Плавный', s_snap_angle: 'Угол поворота', s_vignette: 'Виньетка комфорта', s_height: 'Смещение роста', s_seated: 'Режим сидя',
    s_quality: 'Профиль качества', q_low: 'Производительность', q_med: 'Баланс', q_high: 'Качество', s_shadows: 'Тени', s_grass: 'Плотность травы', s_refresh: 'Частота кадров', s_foveation: 'Фовеация', s_res: 'Масштаб разрешения',
    s_master: 'Общая громкость', s_sfx: 'Эффекты', s_amb: 'Звуки природы', s_ui: 'Интерфейс', on: 'Вкл', off: 'Выкл', low: 'Низк.', medium: 'Средн.', high: 'Высок.',
    language: 'Язык', credits: 'Авторы',
    credits_body: 'FUTON GOLF VR\n\nИгра от FUTON GROUP\n\nГеймдизайн · Физика · Движок · Графика · Звук\nFUTON GROUP\n\nСобственный движок на WebGL2 + WebXR.\nВсе модели, рельеф, небо и звуки создаются процедурно.\n\nСпасибо, что играете!',
    pause: 'Пауза', resume: 'Продолжить', restart_hole: 'Заново лунку', scorecard: 'Карта счёта', main_menu: 'Главное меню', next_hole: 'Следующая лунка', finish: 'Завершить', play_again: 'Сыграть ещё', prev_hole: 'Предыдущая лунка', skip_hole: 'Пропустить лунку',
    hint_grab: 'Сожмите GRIP рядом с клюшкой, чтобы взять её', hint_swing: 'Замахнитесь и проведите клюшкой через мяч — удар физический', hint_goto: 'B — к мячу   ·   X — найти мяч', hint_club: 'A — следующая клюшка · нажатие правого стика — предыдущая', hint_move: 'Левый стик: ходьба   ·   Правый стик: поворот / вперёд — телепорт',
    hint_recall: 'Удерживайте GRIP пустой рукой, чтобы вернуть клюшку', hint_menu: 'Y — меню паузы', hint_practice: 'Тренировка: курок + B — вернуть мяч на ти',
    tee_off: 'Первый удар', on_green: 'На грине', in_hole: 'В лунке!', water: 'Водная преграда', water_pen: 'Водная преграда · 1 штрафной удар', ob: 'Аут · удар и расстояние', lost: 'Мяч потерян', picked_up: 'Мяч поднят',
    shot_info: '{d} {u} · мяч {bs} км/ч', carry: 'Полёт', roll: 'Накат', club_speed: 'Скорость клюшки', ball_speed: 'Скорость мяча', launch: 'Угол вылета', spin: 'Вращение', distance: 'Дистанция',
    sc_albatross: 'Альбатрос!', sc_eagle: 'Игл!', sc_birdie: 'Бёрди!', sc_par: 'Пар', sc_bogey: 'Боги', sc_double: 'Дабл-боги', sc_triple: 'Трипл-боги', sc_over: '+{n}', sc_ace: 'ЛУНКА С ОДНОГО УДАРА!',
    round_complete: 'Раунд завершён', best: 'Рекорд', new_best: 'Новый личный рекорд!', even: 'E', vs_par: 'к пару', time_total: 'Время',
    surf_rough: 'Раф', surf_fairway: 'Фервей', surf_green: 'Грин', surf_sand: 'Бункер', surf_tee: 'Ти', surf_fringe: 'Кайма', surf_deep: 'Глубокий раф', surf_water: 'Вода', surf_rock: 'Камни', surf_beach: 'Пляж', surf_path: 'Дорожка',
    ball_found: 'Мяч подсвечен', club_recalled: 'Клюшка вернулась в руку', desktop_help: 'WASD — ходьба · Мышь — обзор (клик) · Зажмите ЛКМ и ведите — замах · 1-9 клюшки · B к мячу · F найти мяч · Esc пауза',
    perf_warn: 'Снижаем детализацию для плавной частоты кадров', hand_left: 'Левая рука', hand_right: 'Правая рука', practice_reset: 'Мяч возвращён',
  },
};
let LANG = 'en';
function T(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
