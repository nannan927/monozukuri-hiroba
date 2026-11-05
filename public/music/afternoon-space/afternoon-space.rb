# 午後の余白 — Sonic Pi用オリジナル・ビート
# 全文を空のバッファへ貼り付けてRun。終了はStop。
# 内蔵音源のみ。44小節（約123秒）で一周します。

use_bpm 86
use_random_seed 241

# ここを変更してRunすると、次の小節から反映されます。
set :swing_amount, 0.035 # 0.0〜0.07程度。裏の16分音符の遅れ
set :keys_level, 0.65
set :drums_level, 1.0
set :bass_level, 0.8 # ベース全体の音量
set :bass_body, 0.3 # 丸い低域の重ね具合。目安0〜0.5
set :theme_level, 0.62 # 動画由来のピアノ・メロディー。0でミュート
set :melody_level, 0.26 # 0にするとピアノのメロディーなし
set :vocal_level, 0.24 # 声の合いの手。0でミュート
set :vocal_tune, 0 # 声の音程の微調整（半音単位）
set :horn_level, 0.42 # 管楽器風シンセの音量
set :horn_voice, :square # 主役のクラリネット風
set :horn_colors, true # falseで全セクションをhorn_voiceに固定
set :keys_space, 0.16 # ピアノの残響量
set :horn_space, 0.23 # 管楽器の残響量
set :horn_expression, 1.0 # 息づかい。0で音量・明るさの動きを停止

# 16小節の和声ループ（各コード2小節）
# Dm9 / G13 / Cmaj9 / A7(b9) / Fmaj9 / Bbmaj9 / Em7 / A7(b9)
# 低音はベースに任せ、ピアノの中域に余白を残します。
voicings = [[:f3, :a3, :c4, :e4],
            [:f3, :a3, :b3, :e4],
            [:e3, :g3, :b3, :d4],
            [:g3, :bb3, :cs4, :e4],
            [:a3, :c4, :e4, :g4],
            [:a3, :c4, :d4, :f4],
            [:g3, :b3, :d4, :e4],
            [:g3, :bb3, :cs4, :e4]]
roots = [:d2, :g1, :c2, :a1, :f2, :bb1, :e2, :a1]
thirds = [:f2, :b1, :e2, :cs2, :a2, :d2, :g2, :cs2]
phrases = [[:a4, :e5, :d5], [:e5, :d5, :b4],
           [:g4, :b4, :d5], [:e5, :cs5, :bb4],
           [:a4, :g4, :e4], [:f4, :d4, :c4],
           [:b4, :g4, :e4], [:bb4, :e5, :cs5]]
# 4小節の呼吸：長くつなぐ → 短い応答 → 展開 → 余白。
horn_phrases = [[:e4, :f4, :a4], [:a4, :g4, :e4],
                [:d4, :e4, :g4], [:e4, :cs4, :bb3],
                [:g4, :e4, :c4], [:d4, :f4, :a4],
                [:b3, :d4, :g4], [:bb3, :cs4, :e4]]

# 各イベントは [開始拍, 音の番号, 保持の長さ, 強さ]。
# 保持の長さはattack/decay込み。releaseだけ次の音に重なります。
horn_shapes = [
  [[0.12, 0, 1.25, 0.65], [1.37, 1, 1.25, 0.75], [2.62, 2, 1.15, 0.62]],
  [[0.35, 2, 0.35, 0.72], [1.1, 1, 0.4, 0.6], [2.1, 0, 0.95, 0.65]],
  [[0.12, 0, 0.75, 0.6], [0.87, 1, 1.0, 0.7], [1.87, 2, 1.75, 0.74]],
  [[0.35, 1, 0.7, 0.65], [1.35, 0, 1.15, 0.52]]
]

# 動画の推定メロディーを2小節に整理。
# 上がる装飾 → 下降 → 跳躍 → 間 → 返答、という輪郭を残します。
# [開始拍, 音列の番号, 保持する拍数, 強さ]
theme_rhythm = [
  [[0.12, 2, 0.13, 0.65], [0.37, 3, 0.24, 0.78],
   [0.87, 1, 0.38, 0.70], [1.62, 0, 0.30, 0.65],
   [2.12, 4, 0.70, 0.85]],
  [[0.12, 5, 0.32, 0.78], [0.62, 2, 0.13, 0.65],
   [0.87, 3, 0.22, 0.72], [1.37, 1, 0.30, 0.70],
   [1.87, 2, 0.35, 0.66], [2.62, 0, 0.28, 0.62],
   [3.12, 4, 0.55, 0.82]]
]
# コードごとの6音。原動画の絶対音程をそのまま当てず和声に合わせます。
theme_notes = [
  [:c4, :d4, :e4, :f4, :a4, :c5], # Dm9
  [:b3, :d4, :e4, :f4, :a4, :b4], # G13
  [:b3, :c4, :d4, :e4, :g4, :b4], # Cmaj9
  [:bb3, :cs4, :e4, :g4, :a4, :bb4], # A7(b9)
  [:c4, :e4, :f4, :g4, :a4, :c5], # Fmaj9
  [:c4, :d4, :f4, :a4, :bb4, :d5], # Bbmaj9
  [:b3, :d4, :e4, :g4, :b4, :d5], # Em7
  [:bb3, :cs4, :e4, :g4, :a4, :bb4] # A7(b9)
]

# コーラスの目立つ音域をコードトーンへ寄せるための目標音。
# 元素材は多声音なので、完全な単音への変換ではありません。
vocal_notes = [:a3, :b3, :g3, :cs4, :a3, :d4, :b3, :cs4]
vocal_reply_bars = [11, 15, 27, 31, 35, 39]

# 全体の残響を外し、ピーク用の余裕を少し確保します。
with_fx :level, amp: 0.9 do
  live_loop :afternoon do
    bar = tick(:song_bar) % 44
    harmony = (bar / 2) % 8
    swing = get(:swing_amount)
    keys = get(:keys_level)
    drums = get(:drums_level)
    bass = get(:bass_level)
    melody = get(:melody_level)
    horn = get(:horn_level)
    horn_voice = get(:horn_voice)
    # 0〜3:intro / 4〜11:A / 12〜19:B / 20〜23:break
    # 24〜31:A変奏 / 32〜39:climax / 40〜43:outro
    full_drums = bar >= 4 && !(bar >= 20 && bar < 24) && bar < 42
    lead_in = (bar >= 8 && bar < 20) || (bar >= 24 && bar < 40)
    theme_in = (bar >= 8 && bar < 12) || (bar >= 24 && bar < 28) || (bar >= 36 && bar < 40)
    theme_active = theme_in && get(:theme_level) > 0
    lead_in = lead_in && !theme_active
    section_end = [19, 23, 31, 39, 43].include?(bar)
    # 音色はフレーズ単位で交代。1音ごとにランダムには変えません。
    voice = horn_voice
    tone = 80
    voice_gain = 1.0
    if get(:horn_colors)
      if bar >= 12 && bar < 20
        voice = :tri
        tone = 95
        voice_gain = 1.2
      elsif bar >= 32 && bar < 36
        voice = :saw
        tone = 84
        voice_gain = 0.82
      end
    end
    keys = keys * 0.8 if lead_in
    keys = keys * 0.68 if theme_active
    drums = drums * 0.75 if bar >= 40

    with_fx :reverb, room: 0.55, mix: get(:keys_space) do
      # 和音の各音をわずかにずらして、鍵盤を弾く感触に。
      voicings[harmony].each_with_index do |n, i|
        at 0.025 + i * 0.012 do
          synth :piano, note: n, amp: keys * rrand(0.85, 1.0),
            attack: 0.005, release: (section_end ? 1.5 : 2.8), cutoff: 88, pan: -0.12
        end
      end
      if bar.odd? && !section_end
        at 2.65 do
          synth :piano, note: voicings[harmony], amp: keys * 0.42,
            release: 1.1, cutoff: 83, pan: -0.08
        end
      end
    end

    # 指で弾くような輪郭(:tri)と、短い丸い低域(:sine)を重ねます。
    # キックの直後に置き、音の間に隙間を残して低域を整理します。
    if bar >= 2
      root = note(roots[harmony])
      next_bar = (bar + 1) % 44
      next_root = note(roots[(next_bar / 2) % 8])
      sparse_bass = bar < 4 || (bar >= 20 && bar < 24) || bar >= 40
      bass_events = [[0.035, root, 0.7, 1.0]]
      if sparse_bass
        bass_events << [2.5, root + 7, 0.38, 0.48] unless section_end
      elsif bar.even?
        bass_events << [1.75 + swing, root + 7, 0.3, 0.62]
        bass_events << [2.53, root, 0.58, 0.85]
        bass_events << [3.5, note(thirds[harmony]), 0.28, 0.5] if bar % 4 == 2
      else
        bass_events << [1.53, note(thirds[harmony]), 0.38, 0.65]
        bass_events << [2.53, root + 7, 0.32, 0.72]
        # コードが変わる直前に、次のルートの半音下から接近。
        bass_events << [3.5, next_root - 1, 0.28, 0.58] unless section_end
      end
      bass_events.each do |t, pitch, length, accent|
        at t do
          bass_amp = bass * accent * (sparse_bass ? 0.78 : 1.0)
          synth :tri, note: pitch, amp: bass_amp,
            attack: 0.008, decay: 0.13, sustain: length - 0.138,
            sustain_level: 0.48, release: 0.11, cutoff: 78, pan: 0
          synth :sine, note: pitch, amp: bass_amp * get(:bass_body),
            attack: 0.012, decay: 0.1, sustain: length - 0.112,
            sustain_level: 0.65, release: 0.09, pan: 0
        end
      end
    end

    with_fx :reverb, room: 0.55, mix: get(:keys_space) do
      # 管が休む4小節目に、鍵盤が短く返答します。
      if (lead_in && bar % 4 == 3) || (bar >= 20 && bar < 24)
        [2.65, 3.15].each_with_index do |t, i|
          at t do
            synth :piano, note: phrases[harmony][i],
              amp: melody * [0.8, 1.0, 0.65][i],
              release: 0.65, cutoff: 93, pan: 0.2
          end
        end
      end
    end

    # 主題の間は管楽器を休ませ、伴奏を下げてピアノを前へ。
    if theme_active
      with_fx :reverb, room: 0.55, mix: get(:keys_space) do
        theme_rhythm[bar % 2].each do |t, index, length, accent|
          pitch = theme_notes[harmony][index]
          # 最後のA7はC#で締め、次のDmへの解決を予感させます。
          pitch = :cs5 if bar == 39 && index == 4
          at t do
            synth :piano, note: pitch, amp: get(:theme_level) * accent,
              attack: 0.005, sustain: length, release: 0.18,
              cutoff: 100, pan: 0.05
          end
        end
      end
    end

    # 長い音ではレガート、短い応答では明確に区切ります。
    if lead_in
      with_fx :reverb, room: 0.65, mix: get(:horn_space) do
        horn_shapes[bar % 4].each do |t, phrase_index, hold, accent|
          n = horn_phrases[harmony][phrase_index]
          n = phrases[harmony][2] if bar >= 28 && bar % 4 == 3 && phrase_index == 0
          at t do
            expression = get(:horn_expression)
            base_amp = horn * accent * voice_gain
            s = synth voice, note: n, amp: base_amp * (1 - 0.12 * expression),
              attack: (hold < 0.5 ? 0.025 : 0.06), decay: 0.1,
              sustain: hold - (hold < 0.5 ? 0.125 : 0.16),
              sustain_level: 0.85, release: (hold < 0.5 ? 0.07 : 0.12),
              cutoff: tone - 4 * expression, pan: 0.15,
              amp_slide: 0.1, cutoff_slide: 0.1
            # このsleepはat内の別スレッドなので、ドラムの拍を動かしません。
            sleep hold * 0.18
            control s, amp: base_amp * (1 + 0.06 * expression),
              cutoff: tone + 3 * expression
            sleep hold * 0.52
            control s, amp_slide: hold * 0.25, cutoff_slide: hold * 0.25,
              amp: base_amp * (1 - 0.2 * expression), cutoff: tone - 5 * expression
          end
        end
      end
    end

    # 管の語尾が消えた後に短い声。ブレイクだけ長めに響かせます。
    vocal_events = []
    vocal_events = [[3.55, 0.16, 0.7]] if vocal_reply_bars.include?(bar) && !theme_active
    vocal_events = [[0.5, 0.65, 1.0]] if bar == 20
    vocal_events = [[1.5, 0.2, 0.75], [2.25, 0.16, 0.55]] if bar == 22
    if !vocal_events.empty? && get(:vocal_level) > 0
      with_fx :reverb, room: 0.65, mix: 0.26 do
        vocal_events.each do |t, length, accent|
          at t do
            # 公開素材のスペクトルで強いEb付近を基準にした概算調律。
            shift = note(vocal_notes[harmony]) - note(:eb4) + get(:vocal_tune)
            sample :ambi_choir, start: 0.15, finish: 0.85,
              rate: 2 ** (shift / 12.0), amp: get(:vocal_level) * accent,
              attack: 0.025, sustain: length, release: 0.12,
              hpf: 65, lpf: 95, pan: -0.22
          end
        end
      end
    end

    # 16分の長短を交互にし、合計は必ず4拍に保ちます。
    16.times do |step|
      # セクション末尾の最後の1拍でドラムを抜きます。
      drum_space = section_end && step >= 12
      if full_drums && !drum_space
        kick_steps = [[0, 7, 10], [0, 6, 11], [0, 7, 10, 14], [0, 6, 10]][bar % 4]
        if kick_steps.include?(step)
          sample :bd_haus, amp: drums * (step == 0 ? 1.1 : 0.82),
            lpf: 94, rate: 0.9
        end
        if [4, 12].include?(step)
          at 0.035 do
            # 2拍目は芯、4拍目は少し強い返答。補助音はアタックだけ。
            snare_accent = step == 4 ? 0.76 : 0.82
            sample :sn_dolf, amp: drums * snare_accent,
              lpf: 106, attack: 0, sustain: 0.09, release: 0.19
            sample :drum_snare_hard, amp: drums * 0.2,
              hpf: 72, lpf: 108, attack: 0, sustain: 0.015, release: 0.06
          end
        end
        if [14, 15].include?(step) && bar % 8 == 7
          sample :drum_snare_soft, amp: drums * (step == 14 ? 0.23 : 0.34),
            lpf: 84, attack: 0, sustain: 0.025, release: 0.1
        end
      end
      if step.even? && bar >= 4 && bar < 43 && !drum_space && !(bar % 4 == 3 && step == 14)
        sample :drum_cymbal_closed,
          amp: drums * rrand(0.12, 0.19) * (full_drums ? 1 : 0.45),
          rate: rrand(0.94, 1.04), lpf: 92, pan: 0.24
      end
      sleep(step.even? ? 0.25 + swing : 0.25 - swing)
    end
  end
end
