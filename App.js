import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, Alert, Switch, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@workout_planner_state_v1';

const EXERCISES = {
  chest: {
    base: ['Жим штанги лёжа', 'Жим гантелей'],
    isolate: ['Разводка гантелей', 'Кроссовер']
  },
  back: {
    base: ['Тяга штанги в наклоне', 'Подтягивания'],
    isolate: ['Тяга верхнего блока', 'Пуловер']
  },
  legs: {
    base: ['Приседания', 'Жим ногами'],
    isolate: ['Разгибания ног', 'Сгибания ног']
  },
  shoulders: {
    base: ['Жим штанги стоя'],
    isolate: ['Подъём гантелей в стороны']
  },
  arms: {
    base: ['Подъём штанги на бицепс', 'Французский жим'],
    isolate: ['Сгибания гантелей', 'Разгибания блока']
  },
  abs: {
    base: ['Подъёмы ног в висе'],
    isolate: ['Скручивания']
  }
};

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


// Helpers to compute schedule
function addDays(date, days) {
  const nd = new Date(date);
  nd.setDate(nd.getDate() + days);
  return nd;
}

function weekdayIndex(d) {
  // Monday = 1 ... Sunday = 0 or 7 -> normalize to 1..7
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

function findNextScheduled(startFrom, profile) {
  // profile.schedule: '3day' or '2x2'
  const today = new Date(startFrom);
  let attempts = 0;
  while (attempts < 365) {
    if (isScheduledDay(today, profile)) return new Date(today);
    attempts++;
    today.setDate(today.getDate() + 1);
  }
  return null;
}

function isScheduledDay(date, profile) {
  if (!profile) return false;
  const wi = weekdayIndex(date);
  if (profile.schedule === '3day') {
    return wi === 1 || wi === 3 || wi === 5;
  } else if (profile.schedule === '2x2') {
    const monday = new Date(date);
    const diff = (weekdayIndex(date) - 1);
    const cyclePos = diff % 4;
    return cyclePos === 0 || cyclePos === 1;
  }
  return false;
}

function prevScheduledBefore(date, profile) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  let attempts = 0;
  while (attempts < 365) {
    if (isScheduledDay(d, profile)) return new Date(d);
    d.setDate(d.getDate() - 1);
    attempts++;
  }
  return null;
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function getExerciseCount(exp) {
  if (exp === 'меньше года') return 2;
  if (exp === '1-3 года') return 3;
  return 4;
}

function getBaseRatio(exp) {
  return exp === 'меньше года' ? 0.7 : 0.5;
}


function generateProgram(profile) {
  const {
    type,
    gender,
    experience,
    schedule,
    focusOn,
    focusOnSelected
  } = profile;

  //структура недели
  let week;

  if (schedule === '3day') {
    week = [
      { day: 'День 1', groups: ['chest', 'shoulders', 'arms'] },
      { day: 'День 2', groups: ['back', 'arms'] },
      { day: 'День 3', groups: ['legs', 'abs'] },
    ];
  } else {
    week = [
      { day: 'День A (Верх тела)', groups: ['chest', 'back', 'shoulders', 'arms'] },
      { day: 'День B (Низ тела)', groups: ['legs', 'abs'] },
    ];
  }

  //подборка упражнений
  const exercisesPerGroup = getExerciseCount(experience);
  const baseRatio = getBaseRatio(experience);

  function pickExercises(group) {
    const db = EXERCISES[group];
    if (!db) return [];

    const baseCount = Math.round(exercisesPerGroup * baseRatio);
    const isoCount = exercisesPerGroup - baseCount;

    const base = shuffle(db.base).slice(0, baseCount);
    const iso = shuffle(db.isolate).slice(0, isoCount);

    return [...base, ...iso];
  }

  //подходы/повторы
  function getLoad() {
    if (type === 'силовые') {
      if (experience === 'меньше года') return { sets: 3, reps: '5–8' };
      if (experience === '1-3 года') return { sets: 4, reps: '3–6' };
      return { sets: 5, reps: '1–5' };
    } else {
      if (experience === 'меньше года') return { sets: 3, reps: '10–12' };
      if (experience === '1-3 года') return { sets: '3–4', reps: '8–12' };
      return { sets: 4, reps: '6–12' };
    }
  }

  const load = getLoad();

  //сборка программы
  return week.map(d => {
    let groups = [...d.groups];

    if (focusOn && focusOnSelected) {
      const map = {
        'спина': 'back',
        'ноги': 'legs',
        'руки': 'arms',
        'грудь': 'chest',
        'плечи': 'shoulders'
      };
      const g = map[focusOnSelected];
      if (g && !groups.includes(g)) groups.push(g);
    }

    const exercises = groups.flatMap(g => pickExercises(g));

    return {
      day: d.day,
      focus: groups[0],
      exercises,
      meta: load
    };
  });
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState(null);
  const [program, setProgram] = useState(null);
  const [view, setView] = useState('loading');
  const [editing, setEditing] = useState({});
  const [lastCompleted, setLastCompleted] = useState(null);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const state = JSON.parse(raw);
          setProfile(state.profile);
          setProgram(state.program);
          setLastCompleted(state.lastCompleted || null);
          setStreak(state.streak || 0);
          setView('cabinet');
        } else {
          setView('onboarding');
        }
      } catch (e) {
        console.warn('Load err', e);
        setView('onboarding');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    // save on changes
    (async () => {
      const state = { profile, program, lastCompleted, streak };
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){}
    })();
  }, [profile, program, lastCompleted, streak]);

  // Onboarding form state
  const [form, setForm] = useState({
    type: 'бодибилдинг',
    gender: 'м',
    experience: 'меньше года',
    schedule: '3day',
    focusOn: false,
    focusOnSelected: 'спина',
  });

  function submitOnboarding() {
    const p = { ...form };
    setProfile(p);
    const gen = generateProgram(p);
    setProgram(gen);
    setView('editor');
  }

  function regenerate() {
    if (!profile) return;
    const gen = generateProgram(profile);
    setProgram(gen);
    Alert.alert('Сгенерировано', 'Новая программа сгенерирована.');
  }

  function saveAndGoCabinet() {
    setView('cabinet');
    // ensure persisted by effect
  }

  function editExercise(dayIdx, newText) {
    const copy = JSON.parse(JSON.stringify(program));
    copy[dayIdx].exercises = newText.split('\n').map(s => s.trim()).filter(Boolean);
    setProgram(copy);
  }

  function markWorkoutDone() {
    const now = new Date();
    const todayStr = formatDate(now);
    if (!profile) return;

    // Можно отмечать только в запланированный день
    if (!isScheduledDay(now, profile)) {
      Alert.alert('Сегодня не запланирован тренировочный день по выбранному графику');
      return;
    }

    // Нельзя отметить тренировку повторно в тот же день
    if (lastCompleted === todayStr) {
      Alert.alert('Тренировка уже сохранена', 'Сегодняшняя тренировка уже была отмечена.');
      return;
    }

    let newStreak = 1;
    if (lastCompleted) {
      const last = new Date(lastCompleted);
      const prevScheduled = prevScheduledBefore(now, profile);
      if (prevScheduled && formatDate(last) === formatDate(prevScheduled)) {
        newStreak = streak + 1;
      } else {
        let cur = addDays(last, 1);
        let missed = 0;
        while (cur < now) {
          if (isScheduledDay(cur, profile)) missed++;
          cur = addDays(cur, 1);
        }
        newStreak = missed === 0 ? streak + 1 : 1;
      }
    }

    setLastCompleted(todayStr);
    setStreak(newStreak);
    Alert.alert('Отлично!', `Тренировка сохранена. Текущая серия: ${newStreak}`);
  }


  function renderOnboarding() {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={styles.h1}>Добро пожаловать — составитель программ тренировок</Text>

          <Text style={styles.label}>Тип: бодибилдинг / силовые</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, form.type==='бодибилдинг' && styles.btnActive]} onPress={()=>setForm({...form,type:'бодибилдинг'})}><Text>Бодибилдинг</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, form.type==='силовые' && styles.btnActive]} onPress={()=>setForm({...form,type:'силовые'})}><Text>Силовые</Text></TouchableOpacity>
          </View>

          <Text style={styles.label}>Пол</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, form.gender==='м' && styles.btnActive]} onPress={()=>setForm({...form,gender:'м'})}><Text>М</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, form.gender==='ж' && styles.btnActive]} onPress={()=>setForm({...form,gender:'ж'})}><Text>Ж</Text></TouchableOpacity>
          </View>

          <Text style={styles.label}>Опыт занятий</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, form.experience==='меньше года'&&styles.btnActive]} onPress={()=>setForm({...form,experience:'меньше года'})}><Text>&lt; года</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, form.experience==='1-3 года'&&styles.btnActive]} onPress={()=>setForm({...form,experience:'1-3 года'})}><Text>1-3 года</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, form.experience==='больше 3 лет'&&styles.btnActive]} onPress={()=>setForm({...form,experience:'больше 3 лет'})}><Text>&gt;3 года</Text></TouchableOpacity>
          </View>

          <Text style={styles.label}>График</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, form.schedule==='3day'&&styles.btnActive]} onPress={()=>setForm({...form,schedule:'3day'})}><Text>3 дня (Пн/Ср/Пт)</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, form.schedule==='2x2'&&styles.btnActive]} onPress={()=>setForm({...form,schedule:'2x2'})}><Text>2x2 (начиная с Пн)</Text></TouchableOpacity>
          </View>

          <View style={{marginTop:12}}>
            <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
              <Text style={styles.label}>Акцент на группах мышц</Text>
              <Switch value={form.focusOn} onValueChange={(v)=>setForm({...form, focusOn:v})} />
            </View>
            {form.focusOn && (
              <View style={styles.row}>
                {['спина','ноги','руки','грудь','плечи','грудь+спина','руки+плечи'].map(opt=> (
                  <TouchableOpacity key={opt} style={[styles.btn, form.focusOnSelected===opt && styles.btnActive]} onPress={()=>setForm({...form, focusOnSelected:opt})}><Text>{opt}</Text></TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.primary} onPress={submitOnboarding}><Text style={{color:'#fff'}}>Сгенерировать программу</Text></TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  function renderEditor() {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{padding:16}}>
          <Text style={styles.h1}>Сгенерированная программа</Text>
          <Text style={{marginBottom:8}}>Профиль: {profile && `${profile.type}, опыт: ${profile.experience}, график: ${profile.schedule}`}</Text>

          {program && program.map((p, idx)=> (
            <View key={idx} style={styles.card}>
              <Text style={styles.cardTitle}>{p.day}</Text>
              <Text>Сеты: {p.meta.sets} | Повторы: {p.meta.reps}</Text>
              <Text style={{marginTop:8}}>Упражнения:</Text>
              {editing[idx] ? (
                <View>
                  <TextInput multiline value={p.exercises.join('\n')} onChangeText={(t)=>{
                    editExercise(idx, t);
                  }} style={styles.textarea} />
                  <TouchableOpacity style={styles.smallBtn} onPress={()=>setEditing({...editing, [idx]:false})}><Text>Готово</Text></TouchableOpacity>
                </View>
              ) : (
                <View>
                  {p.exercises.map((e, i)=> <Text key={i}>• {e}</Text>)}
                  <TouchableOpacity style={styles.smallBtn} onPress={()=>setEditing({...editing, [idx]:true})}><Text>Редактировать</Text></TouchableOpacity>
                </View>
              )}
            </View>
          ))}

          <View style={{height:18}} />
          <TouchableOpacity style={styles.primary} onPress={regenerate}><Text style={{color:'#fff'}}>Сгенерировать новую</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.primary, {backgroundColor:'#888', marginTop:8}]} onPress={saveAndGoCabinet}><Text style={{color:'#fff'}}>Сохранить и перейти в личный кабинет</Text></TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  function resetAll() {
  const ok = window.confirm('Вы уверены, что хотите удалить все данные?');
  if (!ok) return;

  AsyncStorage.removeItem(STORAGE_KEY).then(() => {
      setProfile(null);
      setProgram(null);
      setLastCompleted(null);
      setStreak(0);
      setView('onboarding');
    });
  }



  function renderCabinet() {
    const next = findNextScheduled(new Date(), profile);
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{padding:16}}>
          <Text style={styles.h1}>Личный кабинет</Text>
          <Text>Программа: {profile && `${profile.type}, график: ${profile.schedule}`}</Text>
          <View style={{marginVertical:8}}>
            <Text style={styles.sub}>Дата следующей запланированной тренировки:</Text>
            <Text style={styles.big}>{next ? formatDate(next) : '—'}</Text>
          </View>

          <View style={{marginVertical:8}}>
            <Text style={styles.sub}>Текущая серия посещений (без пропусков):</Text>
            <Text style={styles.big}>{streak}</Text>
            <Text style={{fontSize:12,color:'#444'}}>Последняя отмеченная тренировка: {lastCompleted || 'не было'}</Text>
          </View>

          <TouchableOpacity
            style={[styles.primary, (!isScheduledDay(new Date(), profile) || lastCompleted === formatDate(new Date())) && { backgroundColor: '#aaa' }]}
            onPress={markWorkoutDone}
            disabled={!isScheduledDay(new Date(), profile) || lastCompleted === formatDate(new Date())}
          ><Text style={{color:'#fff'}}>Отметить сегодняшнюю тренировку как пройденную</Text></TouchableOpacity>

          <View style={{height:12}} />
          <Text style={styles.h2}>Программа (редактируемая)</Text>
          {program && program.map((p, idx)=> (
            <View key={idx} style={styles.card}>
              <Text style={styles.cardTitle}>{p.day}</Text>
              <Text>Сеты: {p.meta.sets} | Повторы: {p.meta.reps}</Text>
              {p.exercises.map((e,i)=>(<Text key={i}>• {e}</Text>))}
              <TouchableOpacity style={styles.smallBtn} onPress={()=>{ setEditing({...editing, [idx]:true}); setView('editor'); }}><Text>Редактировать</Text></TouchableOpacity>
            </View>
          ))}

          <View style={{height:16}} />
          <TouchableOpacity
            style={styles.secondary}
            onPress={resetAll}
          >
          <Text>Сбросить все данные</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!loaded) return <SafeAreaView style={styles.container}><Text>Загрузка...</Text></SafeAreaView>;

  if (view === 'onboarding') return renderOnboarding();
  if (view === 'editor') return renderEditor();
  if (view === 'cabinet') return renderCabinet();

  return (
    <SafeAreaView style={styles.container}><Text>...</Text></SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:'#f7f7f8'},
  h1: { fontSize:20, fontWeight:'700', marginBottom:12 },
  h2: { fontSize:16, fontWeight:'700', marginTop:8 },
  label: { marginBottom:6, fontWeight:'600' },
  row: { flexDirection:'row', flexWrap:'wrap', gap:8 },
  btn: { padding:8, borderWidth:1, borderColor:'#ddd', borderRadius:8, margin:4 },
  btnActive: { backgroundColor:'#e0f2ff', borderColor:'#74b9ff' },
  primary: { marginTop:12, backgroundColor:'#2196f3', padding:12, borderRadius:8, alignItems:'center' },
  smallBtn: { marginTop:8, alignSelf:'flex-start', padding:6, borderRadius:6, borderWidth:1, borderColor:'#ccc' },
  textarea: { borderWidth:1, borderColor:'#ddd', borderRadius:8, minHeight:80, padding:8, marginTop:8 },
  card: { backgroundColor:'#fff', padding:12, borderRadius:8, marginBottom:10, shadowColor:'#000', shadowOpacity:0.03, elevation:1 },
  cardTitle: { fontWeight:'700' },
  sub: { fontWeight:'600', color:'#333' },
  big: { fontSize:18, fontWeight:'700', marginTop:6 },
  secondary: {
  padding: 12,
  borderWidth: 1,
  borderColor: '#ccc',
  borderRadius: 8,
  marginTop: 16,
  pointerEvents: 'auto',
  zIndex: 999,
  },
});
